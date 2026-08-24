/**
 * Canonical credit ledger (pricing overhaul brief, section 8): atomic
 * reservations, capture-on-completion, exact-once refunds, idempotency
 * keys, an immutable audit trail. This IS the live charging path -- every
 * generation route (app/api/projects/{script,ugc,repurpose}) reserves
 * through here, and every job runner (lib/jobs/*-runner.ts) captures or
 * releases through here on completion/failure. lib/pricing/flags.ts's
 * isPricingV2Enabled() has no real call site anywhere in the app (confirmed
 * via grep, referenced only from its own test) -- it is not a working
 * kill-switch for this file, despite what an earlier version of this
 * comment claimed. Don't treat this as dead/optional scaffolding.
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

/** The minimal transaction-client shape captureReservationCore actually
 * needs. Deliberately narrower than Prisma's own Prisma.TransactionClient
 * type: this app's `db` singleton is wrapped with `.$extends(...)` (see
 * lib/db.ts, for the Neon cold-start retry wrapper), and the resulting
 * client's own internal transaction-callback type doesn't structurally
 * unify with Prisma's generated TransactionClient type -- a known friction
 * with Prisma Client Extensions. Method-shorthand syntax here (not
 * arrow-typed properties) gets TypeScript's bivariant method checking,
 * which is what lets both the real extended client's tx and a plain test
 * mock satisfy this without fighting the type checker. */
interface ReservationCaptureClient {
  creditReservation: {
    findUnique(args: { where: { id: string } }): Promise<{ status: string } | null>;
    update(args: { where: { id: string }; data: { status: string; resolvedAt: Date } }): unknown;
  };
}

async function captureReservationCore(client: ReservationCaptureClient, reservationId: string): Promise<void> {
  const reservation = await client.creditReservation.findUnique({ where: { id: reservationId } });
  if (!reservation) throw new ReservationNotFoundError(reservationId);
  if (reservation.status !== "reserved") return; // already captured or released -- exact-once, not an error on retry

  await client.creditReservation.update({
    where: { id: reservationId },
    data: { status: "captured", resolvedAt: new Date() },
  });
}

/** Marks a reservation as permanently settled -- the job succeeded, the
 * held credits are not coming back. No balance change (the decrement
 * already happened at reserve time); this only updates the reservation's
 * own status. Opens its own transaction. Use captureReservationInTx
 * instead when the capture needs to commit atomically together with other
 * writes (see lib/jobs/*-runner.ts's success path). */
export async function captureReservation(reservationId: string): Promise<void> {
  await db.$transaction((tx) => captureReservationCore(tx, reservationId));
}

/** Same exact-once capture as captureReservation, but runs against a
 * transaction the CALLER already opened instead of starting its own --
 * must be called from inside an active `db.$transaction(async (tx) => ...)`
 * block.
 *
 * Why this exists (Phase 3 hardening, 2026-08-12): the job runners used to
 * write Project.status="ready" and Job.status="done" first, then call
 * captureReservation() as a separate statement afterward. A crash in that
 * gap left a "done" job whose reservation was still "reserved" forever --
 * startup reconciliation only ever looks at "processing" jobs, so a "done"
 * job was invisible to it and nothing would ever resolve the stuck
 * reservation. Running the capture in the SAME transaction as the
 * Project/Job success writes (see lib/jobs/script-runner.ts and friends)
 * makes "done" and "captured" land together or not at all -- there is no
 * longer a durable state where one happened without the other. */
export async function captureReservationInTx(tx: ReservationCaptureClient, reservationId: string): Promise<void> {
  await captureReservationCore(tx, reservationId);
}

/** The minimal transaction-client shape releaseReservationCore actually
 * needs -- same reasoning and same bivariant-method-shorthand trick as
 * ReservationCaptureClient above. */
interface ReservationReleaseClient {
  creditReservation: {
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      userId: string;
      workspaceId: string | null;
      amount: number;
      status: string;
      idempotencyKey: string;
    } | null>;
    update(args: { where: { id: string }; data: { status: string; resolvedAt: Date } }): unknown;
  };
  user: {
    update(args: { where: { id: string }; data: { credits: { increment: number } } }): unknown;
    findUniqueOrThrow(args: { where: { id: string }; select: { credits: true } }): Promise<{ credits: number }>;
  };
  creditLedgerEntry: {
    create(args: { data: Record<string, unknown> }): unknown;
  };
}

async function releaseReservationCore(
  client: ReservationReleaseClient,
  reservationId: string,
  note?: string
): Promise<void> {
  const reservation = await client.creditReservation.findUnique({ where: { id: reservationId } });
  if (!reservation) throw new ReservationNotFoundError(reservationId);
  // Exact-once: already resolved (captured OR released) -- never refund
  // twice, and never refund a reservation whose job actually succeeded.
  if (reservation.status !== "reserved") return;

  await client.user.update({
    where: { id: reservation.userId },
    data: { credits: { increment: reservation.amount } },
  });

  const user = await client.user.findUniqueOrThrow({ where: { id: reservation.userId }, select: { credits: true } });

  await client.creditReservation.update({
    where: { id: reservationId },
    data: { status: "released", resolvedAt: new Date() },
  });

  await client.creditLedgerEntry.create({
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
}

/** Gives back a reservation's exact held amount -- the job failed, was
 * never actually enqueued, or the user cancelled before it started.
 * Reads the amount from the reservation itself rather than a caller-passed
 * number, so a partial/variable charge (e.g. a repurpose job's real cost)
 * is always refunded for what was actually taken, never a hardcoded
 * constant. Exact-once: calling this twice on an already-released or
 * already-captured reservation is a no-op, not a double refund. Opens its
 * own transaction. Use releaseReservationInTx instead when the release
 * needs to commit atomically together with other writes (see
 * lib/jobs/*-runner.ts's failure path and lib/jobs/claim.ts's
 * reconciliation). */
export async function releaseReservation(reservationId: string, note?: string): Promise<void> {
  await db.$transaction((tx) => releaseReservationCore(tx, reservationId, note));
}

/** Same exact-once release as releaseReservation, but runs against a
 * transaction the CALLER already opened instead of starting its own --
 * must be called from inside an active `db.$transaction(async (tx) => ...)`
 * block.
 *
 * Why this exists (Phase 3.2 hardening, 2026-08-12): the job runners' and
 * reconciliation's failure paths used to write Project.status="failed" and
 * Job.status="failed" first, then call releaseReservation() as a separate
 * statement afterward. A crash in that gap left a "failed" job whose
 * reservation was still "reserved" forever -- reconciliation only ever
 * looks at "processing" jobs, so a "failed" job was invisible to it, same
 * class of bug as the success-path one captureReservationInTx closes.
 * Running the release in the SAME transaction as the Project/Job failure
 * writes makes "failed" and "released" land together or not at all. */
export async function releaseReservationInTx(
  tx: ReservationReleaseClient,
  reservationId: string,
  note?: string
): Promise<void> {
  await releaseReservationCore(tx, reservationId, note);
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
