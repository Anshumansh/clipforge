import { describe, it, expect, vi, beforeEach } from "vitest";

// ------------------------------------------------------------------
// Mocks
// ------------------------------------------------------------------

const resolveApiUserFn = vi.fn();
const requireVerifiedEmailFn = vi.fn();
const rateLimitFn = vi.fn();
const resolveGenerationContextFn = vi.fn();
const reserveGenerationCreditsFn = vi.fn();
const getProjectIdForJobFn = vi.fn();
const releaseReservationFn = vi.fn();
const enqueueJobFn = vi.fn();
const uploadBufferFn = vi.fn();
const canUseVoiceCloneFn = vi.fn();
const canUseAspectRatioFn = vi.fn();

const projectCreate = vi.fn();
const projectUpdate = vi.fn();
const jobCreate = vi.fn();
const creditReservationUpdate = vi.fn();
const creditReservationFindUnique = vi.fn();

type MockDb = {
  project: { create: (...a: unknown[]) => unknown; update: (...a: unknown[]) => unknown };
  job: { create: (...a: unknown[]) => unknown };
  creditReservation: {
    update: (...a: unknown[]) => unknown;
    findUnique: (...a: unknown[]) => unknown;
  };
  $transaction: (fn: (tx: MockDb) => Promise<unknown>) => Promise<unknown>;
};

const mockDb: MockDb = {
  project: { create: (...a: unknown[]) => projectCreate(...a), update: (...a: unknown[]) => projectUpdate(...a) },
  job: { create: (...a: unknown[]) => jobCreate(...a) },
  creditReservation: {
    update: (...a: unknown[]) => creditReservationUpdate(...a),
    findUnique: (...a: unknown[]) => creditReservationFindUnique(...a),
  },
  $transaction: async (fn) => fn(mockDb),
};

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/api-auth", () => ({ resolveApiUser: (...a: unknown[]) => resolveApiUserFn(...a) }));
vi.mock("@/lib/email-verification", () => ({
  requireVerifiedEmail: (...a: unknown[]) => requireVerifiedEmailFn(...a),
  EmailNotVerifiedError: class EmailNotVerifiedError extends Error {},
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...a: unknown[]) => rateLimitFn(...a) }));
vi.mock("@/lib/workspace", () => ({ resolveGenerationContext: (...a: unknown[]) => resolveGenerationContextFn(...a) }));
vi.mock("@/lib/jobs/queue", () => ({ enqueueJob: (...a: unknown[]) => enqueueJobFn(...a) }));
vi.mock("@/lib/storage", () => ({ uploadBuffer: (...a: unknown[]) => uploadBufferFn(...a) }));
vi.mock("@/lib/plans", () => ({ canUseVoiceClone: (...a: unknown[]) => canUseVoiceCloneFn(...a) }));
vi.mock("@/lib/aspect-ratio", () => ({
  ASPECT_RATIOS: ["9:16", "1:1", "16:9"],
  isAspectRatio: (v: unknown) => typeof v === "string" && ["9:16", "1:1", "16:9"].includes(v),
  canUseAspectRatio: (...a: unknown[]) => canUseAspectRatioFn(...a),
}));
vi.mock("@/lib/languages", () => ({ LANGUAGES: [{ code: "en", label: "English" }] }));

class FakeInsufficientCreditsError extends Error {
  constructor() {
    super("Not enough credits to start this render");
    this.name = "InsufficientCreditsError";
  }
}
vi.mock("@/lib/pricing/ledger", () => ({
  InsufficientCreditsError: FakeInsufficientCreditsError,
  releaseReservation: (...a: unknown[]) => releaseReservationFn(...a),
}));

vi.mock("@/lib/pricing/generation-idempotency", () => ({
  reserveGenerationCredits: (...a: unknown[]) => reserveGenerationCreditsFn(...a),
  getProjectIdForJob: (...a: unknown[]) => getProjectIdForJobFn(...a),
  isValidClientOperationId: (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 200,
}));

class FakePrismaKnownRequestError extends Error {
  code: string;
  constructor(message: string, opts: { code: string }) {
    super(message);
    this.code = opts.code;
  }
}
vi.mock("@prisma/client", () => ({ Prisma: { PrismaClientKnownRequestError: FakePrismaKnownRequestError } }));

const { POST } = await import("./route");

const DEFAULT_OP_ID = "op-test-1";

function makeFormRequest(fields: Record<string, string>, opts?: { operationId?: string | null }): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const operationId = opts && "operationId" in opts ? opts.operationId : DEFAULT_OP_ID;
  const headers: Record<string, string> = {};
  if (operationId !== null) headers["Idempotency-Key"] = operationId as string;
  return new Request("https://forgecut.app/api/projects/script", { method: "POST", headers, body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveApiUserFn.mockResolvedValue({ userId: "user-1", plan: "creator" });
  requireVerifiedEmailFn.mockResolvedValue(undefined);
  rateLimitFn.mockReturnValue({ ok: true });
  resolveGenerationContextFn.mockResolvedValue({ creditOwnerId: "user-1", effectivePlan: "creator", workspaceId: null });
  canUseAspectRatioFn.mockReturnValue(true);
  canUseVoiceCloneFn.mockReturnValue(true);
  projectCreate.mockResolvedValue({ id: "proj-1" });
  jobCreate.mockResolvedValue({ id: "job-1" });
  creditReservationUpdate.mockResolvedValue({});
  projectUpdate.mockResolvedValue({});
});

describe("POST /api/projects/script — idempotency", () => {
  it("no double charge: a genuinely new request creates one project and reserves once", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "new", reservationId: "res-1" });

    const res = await POST(makeFormRequest({ topic: "a video about cats" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ projectId: "proj-1" });
    expect(reserveGenerationCreditsFn).toHaveBeenCalledTimes(1);
    expect(reserveGenerationCreditsFn).toHaveBeenCalledWith(
      expect.objectContaining({ clientOperationId: DEFAULT_OP_ID })
    );
    expect(projectCreate).toHaveBeenCalledTimes(1);
    expect(enqueueJobFn).toHaveBeenCalledWith("job-1", "script");
  });

  it("missing Idempotency-Key header is rejected with 400 before any reservation is attempted", async () => {
    const res = await POST(makeFormRequest({ topic: "a video about cats" }, { operationId: null }));

    expect(res.status).toBe(400);
    expect(reserveGenerationCreditsFn).not.toHaveBeenCalled();
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("duplicate identical request (double-click / retry): SAME operation id returns the SAME existing project, never creates a second one", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "in-flight", reservationId: "res-1", jobId: "job-1" });
    getProjectIdForJobFn.mockResolvedValue("proj-existing");

    const res = await POST(makeFormRequest({ topic: "a video about cats" }, { operationId: "op-dup" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ projectId: "proj-existing", duplicate: true });
    expect(projectCreate).not.toHaveBeenCalled(); // no double charge, no duplicate project
  });

  it("lost HTTP response after reservation succeeded: an already-completed duplicate (same operation id) returns the finished project", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "already-completed", reservationId: "res-1", jobId: "job-1" });
    getProjectIdForJobFn.mockResolvedValue("proj-done");

    const res = await POST(makeFormRequest({ topic: "a video about cats" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ projectId: "proj-done", duplicate: true });
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("crash recovery: a 'recoverable' reservation (reserved, no job yet) proceeds to create the project/job using the SAME reservation, not a new charge", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "recoverable", reservationId: "res-crashed" });

    const res = await POST(makeFormRequest({ topic: "a video about cats" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ projectId: "proj-1" });
    expect(reserveGenerationCreditsFn).toHaveBeenCalledTimes(1); // no second reservation attempt
    expect(creditReservationUpdate).toHaveBeenCalledWith({
      where: { id: "res-crashed" },
      data: { jobId: "job-1" },
    });
  });

  it("concurrent duplicate POST requests: losing the job-attach race returns the winner's project WITHOUT releasing the shared reservation", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "new", reservationId: "res-1" });
    creditReservationUpdate.mockRejectedValue(new FakePrismaKnownRequestError("unique violation", { code: "P2002" }));
    creditReservationFindUnique.mockResolvedValue({ id: "res-1", jobId: "job-winner" });
    getProjectIdForJobFn.mockResolvedValue("proj-winner");

    const res = await POST(makeFormRequest({ topic: "a video about cats" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ projectId: "proj-winner", duplicate: true });
    // Must NOT release a reservation we lost the race for -- releasing it here
    // would refund/corrupt the winning request's still-in-flight charge.
    expect(releaseReservationFn).not.toHaveBeenCalled();
  });

  it("no double refund: a genuine (non-race) failure after reservation releases exactly once", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "new", reservationId: "res-1" });
    projectCreate.mockRejectedValue(new Error("db unavailable"));
    releaseReservationFn.mockResolvedValue(undefined);

    await expect(POST(makeFormRequest({ topic: "a video about cats" }))).rejects.toThrow("db unavailable");

    expect(releaseReservationFn).toHaveBeenCalledTimes(1);
    expect(releaseReservationFn).toHaveBeenCalledWith("res-1", expect.any(String));
  });

  it("failed/released operation: a stale retry of an already-failed operation id is refused with a clear terminal error, not silently recharged", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "failed", reservationId: "res-1" });

    const res = await POST(makeFormRequest({ topic: "a video about cats" }, { operationId: "op-dead" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/already failed/i);
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("insufficient credits surfaces as 402 without ever reaching project creation", async () => {
    reserveGenerationCreditsFn.mockRejectedValue(new FakeInsufficientCreditsError());

    const res = await POST(makeFormRequest({ topic: "a video about cats" }));

    expect(res.status).toBe(402);
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("legitimate separate requests: two different topics under two different operation ids both create their own project", async () => {
    reserveGenerationCreditsFn
      .mockResolvedValueOnce({ status: "new", reservationId: "res-1" })
      .mockResolvedValueOnce({ status: "new", reservationId: "res-2" });
    projectCreate.mockResolvedValueOnce({ id: "proj-1" }).mockResolvedValueOnce({ id: "proj-2" });
    jobCreate.mockResolvedValueOnce({ id: "job-1" }).mockResolvedValueOnce({ id: "job-2" });

    const res1 = await POST(makeFormRequest({ topic: "cats" }, { operationId: "op-cats" }));
    const res2 = await POST(makeFormRequest({ topic: "dogs" }, { operationId: "op-dogs" }));

    expect((await res1.json()).projectId).toBe("proj-1");
    expect((await res2.json()).projectId).toBe("proj-2");
    expect(projectCreate).toHaveBeenCalledTimes(2);
  });

  it("new operation id + IDENTICAL content: still creates a NEW project and a NEW charge, not a duplicate", async () => {
    reserveGenerationCreditsFn
      .mockResolvedValueOnce({ status: "new", reservationId: "res-1" })
      .mockResolvedValueOnce({ status: "new", reservationId: "res-2" });
    projectCreate.mockResolvedValueOnce({ id: "proj-1" }).mockResolvedValueOnce({ id: "proj-2" });
    jobCreate.mockResolvedValueOnce({ id: "job-1" }).mockResolvedValueOnce({ id: "job-2" });

    const sameTopic = { topic: "the exact same script, word for word" };
    const res1 = await POST(makeFormRequest(sameTopic, { operationId: "op-1st-generation" }));
    const res2 = await POST(makeFormRequest(sameTopic, { operationId: "op-2nd-generation" }));

    const json1 = await res1.json();
    const json2 = await res2.json();

    expect(json1).toEqual({ projectId: "proj-1" });
    expect(json2).toEqual({ projectId: "proj-2" }); // a genuinely new project, not "duplicate: true"
    expect(reserveGenerationCreditsFn).toHaveBeenCalledTimes(2);
    expect(reserveGenerationCreditsFn.mock.calls[0][0].clientOperationId).toBe("op-1st-generation");
    expect(reserveGenerationCreditsFn.mock.calls[1][0].clientOperationId).toBe("op-2nd-generation");
  });

  it("workspace request: charges the workspace owner's balance while the reservation call is keyed by the actual requesting user", async () => {
    resolveGenerationContextFn.mockResolvedValue({ creditOwnerId: "owner-1", effectivePlan: "business", workspaceId: "ws-1" });
    resolveApiUserFn.mockResolvedValue({ userId: "member-1", plan: "free" });
    reserveGenerationCreditsFn.mockResolvedValue({ status: "new", reservationId: "res-1" });

    await POST(makeFormRequest({ topic: "cats" }));

    expect(reserveGenerationCreditsFn).toHaveBeenCalledWith(
      expect.objectContaining({ requestingUserId: "member-1", creditOwnerId: "owner-1", workspaceId: "ws-1" })
    );
    expect(projectCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ workspaceId: "ws-1", userId: "member-1" }) }));
  });

  it("workspace member retry: the same member resubmitting the same operation id never double-charges the workspace", async () => {
    resolveGenerationContextFn.mockResolvedValue({ creditOwnerId: "owner-1", effectivePlan: "business", workspaceId: "ws-1" });
    resolveApiUserFn.mockResolvedValue({ userId: "member-1", plan: "free" });
    reserveGenerationCreditsFn.mockResolvedValue({ status: "in-flight", reservationId: "res-1", jobId: "job-1" });
    getProjectIdForJobFn.mockResolvedValue("proj-existing");

    const res = await POST(makeFormRequest({ topic: "cats" }, { operationId: "op-ws-retry" }));
    const json = await res.json();

    expect(json).toEqual({ projectId: "proj-existing", duplicate: true });
    expect(projectCreate).not.toHaveBeenCalled();
  });
});
