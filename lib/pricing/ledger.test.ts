import { describe, it, expect, vi, beforeEach } from "vitest";

const userUpdateMany = vi.fn();
const userUpdate = vi.fn();
const userFindUniqueOrThrow = vi.fn();
const reservationFindUnique = vi.fn();
const reservationCreate = vi.fn();
const reservationUpdate = vi.fn();
const ledgerEntryCreate = vi.fn();
const ledgerEntryFindUnique = vi.fn();

const mockTx = {
  user: {
    updateMany: (...a: unknown[]) => userUpdateMany(...a),
    update: (...a: unknown[]) => userUpdate(...a),
    findUniqueOrThrow: (...a: unknown[]) => userFindUniqueOrThrow(...a),
  },
  creditReservation: {
    create: (...a: unknown[]) => reservationCreate(...a),
    findUnique: (...a: unknown[]) => reservationFindUnique(...a),
    update: (...a: unknown[]) => reservationUpdate(...a),
  },
  creditLedgerEntry: {
    create: (...a: unknown[]) => ledgerEntryCreate(...a),
    findUnique: (...a: unknown[]) => ledgerEntryFindUnique(...a),
  },
};

const $transaction = vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx));

vi.mock("@/lib/db", () => ({
  db: { ...mockTx, $transaction: (...a: unknown[]) => $transaction(...(a as [(tx: typeof mockTx) => Promise<unknown>])) },
}));

class FakePrismaKnownRequestError extends Error {
  code: string;
  constructor(message: string, opts: { code: string }) {
    super(message);
    this.code = opts.code;
  }
}

vi.mock("@prisma/client", () => ({
  Prisma: { PrismaClientKnownRequestError: FakePrismaKnownRequestError },
}));

const {
  reserveCredits,
  captureReservation,
  releaseReservation,
  grantCredits,
  InsufficientCreditsError,
  ReservationNotFoundError,
} = await import("./ledger");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reserveCredits", () => {
  it("decrements the balance, records the reservation, and appends a ledger entry", async () => {
    reservationFindUnique.mockResolvedValueOnce(null); // idempotency pre-check
    userUpdateMany.mockResolvedValue({ count: 1 });
    userFindUniqueOrThrow.mockResolvedValue({ credits: 90 });
    reservationCreate.mockResolvedValue({ id: "res-1" });
    ledgerEntryCreate.mockResolvedValue({});

    const result = await reserveCredits({ userId: "u1", amount: 10, idempotencyKey: "key-1" });

    expect(result).toEqual({ reservationId: "res-1", isNew: true });
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: "u1", credits: { gte: 10 } },
      data: { credits: { decrement: 10 } },
    });
    expect(ledgerEntryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "charge", delta: -10, reservationId: "res-1" }),
      })
    );
  });

  it("throws InsufficientCreditsError when the guarded update matches no row", async () => {
    reservationFindUnique.mockResolvedValueOnce(null);
    userUpdateMany.mockResolvedValue({ count: 0 });

    await expect(reserveCredits({ userId: "u1", amount: 999, idempotencyKey: "key-2" })).rejects.toBeInstanceOf(
      InsufficientCreditsError
    );
  });

  it("is idempotent: a replayed key returns the original reservation without charging again", async () => {
    reservationFindUnique.mockResolvedValueOnce({ id: "res-1" });

    const result = await reserveCredits({ userId: "u1", amount: 10, idempotencyKey: "key-1" });

    expect(result).toEqual({ reservationId: "res-1", isNew: false });
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("resolves a concurrent double-reservation race by returning the winner instead of erroring", async () => {
    // Both requests pass the initial idempotency check (neither sees the other's row yet),
    // then race to insert the reservation row -- only one wins the unique constraint.
    reservationFindUnique
      .mockResolvedValueOnce(null) // this request's own pre-check
      .mockResolvedValueOnce({ id: "res-winner" }); // re-query after losing the insert race
    userUpdateMany.mockResolvedValue({ count: 1 });
    userFindUniqueOrThrow.mockResolvedValue({ credits: 90 });
    reservationCreate.mockRejectedValue(new FakePrismaKnownRequestError("unique violation", { code: "P2002" }));

    const result = await reserveCredits({ userId: "u1", amount: 10, idempotencyKey: "key-3" });

    expect(result).toEqual({ reservationId: "res-winner", isNew: false });
  });
});

describe("captureReservation", () => {
  it("marks a reserved hold as captured", async () => {
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });
    reservationUpdate.mockResolvedValue({});

    await captureReservation("res-1");

    expect(reservationUpdate).toHaveBeenCalledWith({
      where: { id: "res-1" },
      data: { status: "captured", resolvedAt: expect.any(Date) },
    });
  });

  it("throws ReservationNotFoundError for an unknown id", async () => {
    reservationFindUnique.mockResolvedValue(null);

    await expect(captureReservation("missing")).rejects.toBeInstanceOf(ReservationNotFoundError);
  });

  it("is a no-op (exact-once) when the reservation is already resolved", async () => {
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "captured" });

    await captureReservation("res-1");

    expect(reservationUpdate).not.toHaveBeenCalled();
  });
});

describe("releaseReservation", () => {
  it("refunds the reservation's exact held amount, not a hardcoded constant", async () => {
    reservationFindUnique.mockResolvedValue({
      id: "res-1",
      userId: "u1",
      workspaceId: null,
      amount: 110, // e.g. a repurpose job's real variable cost -- must not be refunded as a flat "10"
      status: "reserved",
      idempotencyKey: "key-1",
    });
    userUpdate.mockResolvedValue({});
    userFindUniqueOrThrow.mockResolvedValue({ credits: 200 });
    reservationUpdate.mockResolvedValue({});
    ledgerEntryCreate.mockResolvedValue({});

    await releaseReservation("res-1");

    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { credits: { increment: 110 } } });
    expect(ledgerEntryCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "refund", delta: 110 }) })
    );
  });

  it("is a no-op (exact-once) when already released, never double-refunding", async () => {
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "released" });

    await releaseReservation("res-1");

    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("is a no-op when already captured -- a captured job cannot later be refunded by a stray retry", async () => {
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "captured" });

    await releaseReservation("res-1");

    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe("grantCredits", () => {
  it("increments the balance and records an idempotent ledger entry", async () => {
    ledgerEntryFindUnique.mockResolvedValue(null);
    userUpdate.mockResolvedValue({});
    userFindUniqueOrThrow.mockResolvedValue({ credits: 250 });
    ledgerEntryCreate.mockResolvedValue({});

    const result = await grantCredits({
      userId: "u1",
      amount: 250,
      type: "monthly_grant",
      idempotencyKey: "stripe-evt-abc:monthly_grant",
    });

    expect(result).toEqual({ isNew: true });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { credits: { increment: 250 } } });
  });

  it("is idempotent: a replayed Stripe webhook does not grant credits twice", async () => {
    ledgerEntryFindUnique.mockResolvedValue({ id: "entry-1" });

    const result = await grantCredits({
      userId: "u1",
      amount: 250,
      type: "monthly_grant",
      idempotencyKey: "stripe-evt-abc:monthly_grant",
    });

    expect(result).toEqual({ isNew: false });
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
