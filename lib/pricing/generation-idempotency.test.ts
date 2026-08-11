import { describe, it, expect, vi, beforeEach } from "vitest";

const reserveCreditsFn = vi.fn();
const creditReservationFindUnique = vi.fn();
const jobFindUnique = vi.fn();

vi.mock("@/lib/pricing/ledger", () => ({
  reserveCredits: (...a: unknown[]) => reserveCreditsFn(...a),
}));

vi.mock("@/lib/db", () => ({
  db: {
    creditReservation: { findUnique: (...a: unknown[]) => creditReservationFindUnique(...a) },
    job: { findUnique: (...a: unknown[]) => jobFindUnique(...a) },
  },
}));

const { reserveGenerationCredits, isValidClientOperationId, getProjectIdForJob } = await import(
  "./generation-idempotency"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isValidClientOperationId", () => {
  it("accepts a normal opaque id (e.g. a UUID)", () => {
    expect(isValidClientOperationId("6f2a9e2e-7e0e-4c2a-9b8d-3a2f6e9c1d10")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidClientOperationId("")).toBe(false);
  });

  it("rejects null/undefined/non-string values", () => {
    expect(isValidClientOperationId(null)).toBe(false);
    expect(isValidClientOperationId(undefined)).toBe(false);
    expect(isValidClientOperationId(42)).toBe(false);
  });

  it("rejects an unreasonably long id", () => {
    expect(isValidClientOperationId("x".repeat(500))).toBe(false);
  });
});

describe("reserveGenerationCredits", () => {
  const baseInput = {
    type: "script" as const,
    requestingUserId: "user-1",
    creditOwnerId: "user-1",
    workspaceId: null,
    amount: 10,
    clientOperationId: "op-aaa",
  };

  it("returns status 'new' for a genuinely first-time operation, keyed by type:user:operationId (no content, no hash, no attempt suffix)", async () => {
    reserveCreditsFn.mockResolvedValue({ reservationId: "res-1", isNew: true });

    const result = await reserveGenerationCredits(baseInput);

    expect(result).toEqual({ status: "new", reservationId: "res-1" });
    expect(reserveCreditsFn).toHaveBeenCalledTimes(1);
    expect(reserveCreditsFn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        idempotencyKey: "gen:script:user-1:op-aaa",
      })
    );
  });

  it("scopes the key by requesting user, not credit owner, even for a solo (non-workspace) request", async () => {
    reserveCreditsFn.mockResolvedValue({ reservationId: "res-1", isNew: true });
    await reserveGenerationCredits({ ...baseInput, requestingUserId: "user-1", creditOwnerId: "owner-9" });
    expect(reserveCreditsFn.mock.calls[0][0].idempotencyKey).toBe("gen:script:user-1:op-aaa");
    expect(reserveCreditsFn.mock.calls[0][0].userId).toBe("owner-9"); // balance still charged to the credit owner
  });

  describe("same operation id + same payload (double-click / retry)", () => {
    it("returns 'in-flight' for a duplicate of an already-job-linked reservation, without a second reserve", async () => {
      reserveCreditsFn.mockResolvedValue({ reservationId: "res-1", isNew: false });
      creditReservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved", jobId: "job-1" });

      const result = await reserveGenerationCredits(baseInput);

      expect(result).toEqual({ status: "in-flight", reservationId: "res-1", jobId: "job-1" });
      expect(reserveCreditsFn).toHaveBeenCalledTimes(1); // one attempt, no re-charge
    });

    it("after a lost HTTP response, an already-completed identical retry returns 'already-completed' instead of charging again", async () => {
      reserveCreditsFn.mockResolvedValue({ reservationId: "res-1", isNew: false });
      creditReservationFindUnique.mockResolvedValue({ id: "res-1", status: "captured", jobId: "job-1" });

      const result = await reserveGenerationCredits(baseInput);

      expect(result).toEqual({ status: "already-completed", reservationId: "res-1", jobId: "job-1" });
    });
  });

  describe("same operation id submitted concurrently", () => {
    it("both calls resolve to the SAME reservation with only one real reserve, thanks to reserveCredits' own P2002 race handling", async () => {
      // reserveCredits (lib/pricing/ledger.ts) already resolves the DB-level
      // race between two concurrent inserts on the same idempotencyKey --
      // this module just has to make sure both concurrent calls compute the
      // exact same key so they actually collide there instead of each
      // minting their own.
      reserveCreditsFn
        .mockResolvedValueOnce({ reservationId: "res-1", isNew: true }) // winner
        .mockResolvedValueOnce({ reservationId: "res-1", isNew: false }); // loser, re-queried by ledger
      creditReservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved", jobId: null });

      const [a, b] = await Promise.all([reserveGenerationCredits(baseInput), reserveGenerationCredits(baseInput)]);

      expect(reserveCreditsFn).toHaveBeenCalledTimes(2);
      expect(reserveCreditsFn.mock.calls[0][0].idempotencyKey).toBe(reserveCreditsFn.mock.calls[1][0].idempotencyKey);
      expect([a.reservationId, b.reservationId]).toEqual(["res-1", "res-1"]);
    });
  });

  describe("crash recovery: reservation succeeds, crash before project/job attachment, retry with the SAME key", () => {
    it("the retry reuses the exact same reservation instead of reserving again", async () => {
      // 1) Original request: reservation is created, then the process
      // crashes before a job is ever attached.
      reserveCreditsFn.mockResolvedValueOnce({ reservationId: "res-crashed", isNew: true });
      const first = await reserveGenerationCredits(baseInput);
      expect(first).toEqual({ status: "new", reservationId: "res-crashed" });

      // 2) Client retries using the SAME idempotency key (same clientOperationId).
      reserveCreditsFn.mockResolvedValueOnce({ reservationId: "res-crashed", isNew: false });
      creditReservationFindUnique.mockResolvedValueOnce({ id: "res-crashed", status: "reserved", jobId: null });
      const retry = await reserveGenerationCredits(baseInput);

      expect(retry).toEqual({ status: "recoverable", reservationId: "res-crashed" });
      // Exactly one reservation was ever ledger-created (isNew:true happened
      // only once) -- the retry reconciles onto it rather than charging
      // again, and both calls used the identical key.
      expect(reserveCreditsFn).toHaveBeenCalledTimes(2);
      expect(reserveCreditsFn.mock.calls[0][0].idempotencyKey).toBe(reserveCreditsFn.mock.calls[1][0].idempotencyKey);
    });
  });

  describe("new operation id + identical content", () => {
    it("creates a NEW reservation and charges again, because identity is the operation id, not the content", async () => {
      reserveCreditsFn
        .mockResolvedValueOnce({ reservationId: "res-1", isNew: true })
        .mockResolvedValueOnce({ reservationId: "res-2", isNew: true });

      const first = await reserveGenerationCredits({ ...baseInput, clientOperationId: "op-first" });
      const second = await reserveGenerationCredits({ ...baseInput, clientOperationId: "op-second" });

      expect(first).toEqual({ status: "new", reservationId: "res-1" });
      expect(second).toEqual({ status: "new", reservationId: "res-2" });
      expect(reserveCreditsFn).toHaveBeenCalledTimes(2);
      const key1 = reserveCreditsFn.mock.calls[0][0].idempotencyKey;
      const key2 = reserveCreditsFn.mock.calls[1][0].idempotencyKey;
      expect(key1).not.toBe(key2); // a deliberate new action always gets a new key, even with the same amount/type/user
    });
  });

  describe("new operation id + different content", () => {
    it("is just an ordinary new reservation -- content plays no role in the key at all", async () => {
      reserveCreditsFn.mockResolvedValue({ reservationId: "res-1", isNew: true });
      const result = await reserveGenerationCredits({ ...baseInput, clientOperationId: "op-unique" });
      expect(result).toEqual({ status: "new", reservationId: "res-1" });
    });
  });

  describe("workspace member retry", () => {
    it("the SAME member retrying the SAME operation id dedupes -- no duplicate workspace charge", async () => {
      reserveCreditsFn.mockResolvedValue({ reservationId: "res-1", isNew: false });
      creditReservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved", jobId: "job-1" });

      const input = { ...baseInput, requestingUserId: "member-a", creditOwnerId: "workspace-owner", workspaceId: "ws-1" };
      const result = await reserveGenerationCredits(input);

      expect(result.status).toBe("in-flight");
      expect(reserveCreditsFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("two different workspace members intentionally submitting identical content", () => {
    it("are separate operations -- different requesting users produce different keys and both charge", async () => {
      reserveCreditsFn.mockResolvedValue({ reservationId: "res-x", isNew: true });

      await reserveGenerationCredits({
        ...baseInput,
        requestingUserId: "member-a",
        creditOwnerId: "workspace-owner",
        workspaceId: "ws-1",
        clientOperationId: "op-a",
      });
      await reserveGenerationCredits({
        ...baseInput,
        requestingUserId: "member-b",
        creditOwnerId: "workspace-owner",
        workspaceId: "ws-1",
        clientOperationId: "op-b",
      });

      expect(reserveCreditsFn).toHaveBeenCalledTimes(2);
      const key1 = reserveCreditsFn.mock.calls[0][0].idempotencyKey;
      const key2 = reserveCreditsFn.mock.calls[1][0].idempotencyKey;
      expect(key1).not.toBe(key2);
      expect(reserveCreditsFn.mock.calls[0][0].userId).toBe("workspace-owner");
      expect(reserveCreditsFn.mock.calls[1][0].userId).toBe("workspace-owner");
    });
  });

  describe("successful captured reservation cannot be released/refunded by a duplicate retry", () => {
    it("a retry against a captured reservation is reported as already-completed, never touching release/capture itself", async () => {
      reserveCreditsFn.mockResolvedValue({ reservationId: "res-1", isNew: false });
      creditReservationFindUnique.mockResolvedValue({ id: "res-1", status: "captured", jobId: "job-1" });

      const result = await reserveGenerationCredits(baseInput);

      // This module only ever reports state -- it never calls
      // captureReservation/releaseReservation itself, so a duplicate retry
      // against a captured reservation has no way to un-capture it. The
      // route layer's job is to treat "already-completed" as terminal,
      // which the route tests cover directly.
      expect(result).toEqual({ status: "already-completed", reservationId: "res-1", jobId: "job-1" });
    });
  });

  describe("failed/released operation behavior", () => {
    it("a released reservation under this exact key is reported as 'failed' -- terminal, not retried under a new attempt", async () => {
      reserveCreditsFn.mockResolvedValue({ reservationId: "res-1", isNew: false });
      creditReservationFindUnique.mockResolvedValue({ id: "res-1", status: "released", jobId: null });

      const result = await reserveGenerationCredits(baseInput);

      expect(result).toEqual({ status: "failed", reservationId: "res-1" });
      // Only ever tries the one key for this operation id -- no attempt
      // chaining, no second reserve under a derived key.
      expect(reserveCreditsFn).toHaveBeenCalledTimes(1);
    });

    it("a genuinely new operation id after a failure gets a fresh reservation instead", async () => {
      reserveCreditsFn.mockResolvedValueOnce({ reservationId: "res-1", isNew: false });
      creditReservationFindUnique.mockResolvedValueOnce({ id: "res-1", status: "released", jobId: null });
      const failed = await reserveGenerationCredits({ ...baseInput, clientOperationId: "op-dead" });
      expect(failed.status).toBe("failed");

      reserveCreditsFn.mockResolvedValueOnce({ reservationId: "res-2", isNew: true });
      const retry = await reserveGenerationCredits({ ...baseInput, clientOperationId: "op-fresh" });
      expect(retry).toEqual({ status: "new", reservationId: "res-2" });
    });
  });
});

describe("getProjectIdForJob", () => {
  it("returns the project id for a known job", async () => {
    jobFindUnique.mockResolvedValue({ projectId: "proj-1" });
    expect(await getProjectIdForJob("job-1")).toBe("proj-1");
  });

  it("returns null for an unknown job", async () => {
    jobFindUnique.mockResolvedValue(null);
    expect(await getProjectIdForJob("missing")).toBeNull();
  });
});
