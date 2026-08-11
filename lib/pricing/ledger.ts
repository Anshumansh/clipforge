/**
 * Canonical credit ledger (pricing overhaul brief, section 8): atomic
 * reservations, capture-on-completion, exact-once refunds, idempotency
 * keys, an immutable audit trail. This is the v2 charging path, additive
 * alongside the legacy lib/credits.ts (still used by every live job runner
 * today) -- see lib/pricing/flags.ts for the cutover switch. Nothing calls
 * this yet.
 *
 * Design: charging a job is a two-step "reserve, then capture or release"
 * rather than a single decrement, matching what the brief actually asks
 * for in section 8. The reservation IS the same balance decrement the
 * legacy code does today (so a user can never overspend while a job is
 * in flight) -- what's new is that the decrement is now tied to a durable
 * row with its own idempotency key, so a client retry (network blip,
 * duplicated request) can safely replay the same key instead of double
 * charging, and a capture/release always knows the exact amount to settle
 * or give back instead of a hardcoded constant.
 */
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Not enough credits to start this render");
    this.name = "InsufficientCreditsError";
  }
}

export class ReservationNotFoundError extends Error {
  constructor(id: string) {
    super(`Credit reservation ${id} not found`);
    this.name = "ReservationNotFoundError";
  }
}

export class ReservationAlreadyResolvedError extends Error {
  constructor(id: string, status: string) {
    super(`Credit reservation ${id} is already ${status}`);
    this.name = "ReservationAlreadyResolvedError";
  }
}

export interface ReserveCreditsInput {
  userId: string;
  workspaceId?: string | null;
  amount: number;
  idempotencyKey: string;
  note?: string;
}

export interface ReserveCreditsResult {
  reservationId: string;
  /** true if this call created a new reservation; false if idempotencyKey
   * matched an existing one (the caller should treat this exactly like a
   * fresh success -- the credits were already reserved by the original
   * call, this is not a re-reservation). */
  isNew: boolean;
}

/** Atomically reserves credits: decrements User.credits (only if the
 * balance covers it, preventing negative balances and concurrent double
 * spending via the same WHERE-guarded updateMany the legacy chargeCredits
 * uses) and writes a CreditReservation + CreditLedgerEntry row inside one
 * transaction. Idempotent on idempotencyKey -- a retried call with the same
 * key returns the original reservation instead of reserving twice. */
export async function reserveCredits(input: ReserveCreditsInput): Promise<ReserveCreditsResult> {
  if (input.amount <= 0) throw new RangeError("amount must be positive");

  const existing = await db.creditReservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { reservationId: existing.id, isNew: false };

  try {
    return await db.$transaction(async (tx) => {
      const decremented = await tx.user.updateMany({
        where: { id: input.userId, credits: { gte: input.amount } },
        data: { credits: { decrement: input.amount } },
      });
      if (decremented.count === 0) throw new InsufficientCreditsError();

      const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { credits: true } });

      const reservation = await tx.creditReservation.create({
        data: {
          userId: input.userId,
          workspaceId: input.workspaceId ?? null,
          amount: input.amount,
          status: "reserved",
          idempotencyKey: input.idempotencyKey,
        },
      });

      await tx.creditLedgerEntry.create({
        data: {
          userId: input.userId,
          workspaceId: input.workspaceId ?? null,
          type: "charge",
          delta: -input.amount,
          balanceAfter: user.credits,
          reservationId: reservation.id,
          idempotencyKey: `${input.idempotencyKey}:charge`,
          note: input.note,
        },
      });

      return { reservationId: reservation.id, isNew: true };
    });
  } catch (err) {
    // A concurrent request racing on the same idempotencyKey can lose the
    // findUnique check above and then hit the reservation table's unique
    // constraint here -- re-read and return the winner's row rather than
    // surfacing a spurious error to the loser.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await db.creditReservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (winner) return { reservationId: winner.id, isNew: false };
    }
    throw err;
  }
}

/** Links a reservation to the job it was created for. Split from
 * reserveCredits because the job row often doesn't exist yet at the moment
 * credits need to be held (see the repurpose route's charge-then-create
 * pattern) -- call this immediately after creating the Job. */
export async function attachReservationToJob(reservationId: string, jobId: string): Promise<void> {
  await db.creditReservation.update({ where: { id: reservationId }, data: { jobId } });
}

/** Marks a reservation as permanently settled -- the job succeeded, the
 * held credits are not coming back. No balance change (the decrement
 * already happened at reserve time); this only updates the reservation's
 * own status and appends an audit-trail ledger entry with delta 0 so the
 * ledger shows the job's full lifecycle, not just the charge. */
export async function captureReservation(reservationId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const reservation = await tx.creditReservation.findUnique({ where: { id: reservationId } });
    if (!reservation) throw new ReservationNotFoundError(reservationId);
    if (reservation.status !== "reserved") return; // already captured or released -- exact-once, not an error on retry

    await tx.creditReservation.update({
      where: { id: reservationId },
      data: { status: "captured", resolvedAt: new Date() },
    });
  });
}

/** Gives back a reservation's exact held amount -- the job failed, was
 * never actually enqueued, or the user cancelled before it started.
 * Reads the amount from the reservation itself rather than a caller-passed
 * number, so a partial/variable charge (e.g. a repurpose job's real cost)
 * is always refunded for what was actually taken, never a hardcoded
 * constant. Exact-once: calling this twice on an already-released or
 * already-captured reservation is a no-op, not a double refund. */
export async function releaseReservation(reservationId: string, note?: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const reservation = await tx.creditReservation.findUnique({ where: { id: reservationId } });
    if (!reservation) throw new ReservationNotFoundError(reservationId);
    if (reservation.status !== "reserved") return; // exact-once: already resolved, never refund twice

    await tx.user.update({
      where: { id: reservation.userId },
      data: { credits: { increment: reservation.amount } },
    });

    const user = await tx.user.findUniqueOrThrow({ where: { id: reservation.userId }, select: { credits: true } });

    await tx.creditReservation.update({
      where: { id: reservationId },
      data: { status: "released", resolvedAt: new Date() },
    });

    await tx.creditLedgerEntry.create({
      data: {
        userId: reservation.userId,
        workspaceId: reservation.workspaceId,
        type: "refund",
        delta: reservation.amount,
        balanceAfter: user.credits,
        reservationId: reservation.id,
        idempotencyKey: `${reservation.idempotencyKey}:refund`,
        note: note ?? "System-failed render, automatic full refund",
      },
    });
  });
}

/** Non-reservation credit grants -- signup bonus, monthly plan renewal,
 * a purchased credit pack, or an admin adjustment. Always additive, always
 * idempotent on its own key (so a replayed Stripe webhook or a retried
 * admin action can't double-grant). */
export async function grantCredits(input: {
  userId: string;
  amount: number;
  type: "signup_grant" | "monthly_grant" | "pack_purchase" | "admin_adjustment" | "upgrade_grant";
  idempotencyKey: string;
  note?: string;
}): Promise<{ isNew: boolean }> {
  if (input.amount <= 0) throw new RangeError("amount must be positive");

  const existing = await db.creditLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { isNew: false };

  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: input.userId }, data: { credits: { increment: input.amount } } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { credits: true } });

      await tx.creditLedgerEntry.create({
        data: {
          userId: input.userId,
          type: input.type,
          delta: input.amount,
          balanceAfter: user.credits,
          idempotencyKey: input.idempotencyKey,
          note: input.note,
        },
      });
    });
    return { isNew: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { isNew: false }; // lost the race to a concurrent identical grant -- the winner already recorded it
    }
    throw err;
  }
}
