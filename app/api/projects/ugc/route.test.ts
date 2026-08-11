import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSessionFn = vi.fn();
const requireVerifiedEmailFn = vi.fn();
const rateLimitFn = vi.fn();
const resolveGenerationContextFn = vi.fn();
const reserveGenerationCreditsFn = vi.fn();
const getProjectIdForJobFn = vi.fn();
const releaseReservationFn = vi.fn();
const enqueueJobFn = vi.fn();
const canUseUgcFn = vi.fn();
const canUseAspectRatioFn = vi.fn();

const userFindUniqueOrThrow = vi.fn();
const projectCreate = vi.fn();
const jobCreate = vi.fn();
const creditReservationUpdate = vi.fn();
const creditReservationFindUnique = vi.fn();

type MockDb = {
  user: { findUniqueOrThrow: (...a: unknown[]) => unknown };
  project: { create: (...a: unknown[]) => unknown };
  job: { create: (...a: unknown[]) => unknown };
  creditReservation: {
    update: (...a: unknown[]) => unknown;
    findUnique: (...a: unknown[]) => unknown;
  };
  $transaction: (fn: (tx: MockDb) => Promise<unknown>) => Promise<unknown>;
};

const mockDb: MockDb = {
  user: { findUniqueOrThrow: (...a: unknown[]) => userFindUniqueOrThrow(...a) },
  project: { create: (...a: unknown[]) => projectCreate(...a) },
  job: { create: (...a: unknown[]) => jobCreate(...a) },
  creditReservation: {
    update: (...a: unknown[]) => creditReservationUpdate(...a),
    findUnique: (...a: unknown[]) => creditReservationFindUnique(...a),
  },
  $transaction: async (fn) => fn(mockDb),
};

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("next-auth", () => ({ getServerSession: (...a: unknown[]) => getServerSessionFn(...a) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/email-verification", () => ({
  requireVerifiedEmail: (...a: unknown[]) => requireVerifiedEmailFn(...a),
  EmailNotVerifiedError: class EmailNotVerifiedError extends Error {},
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...a: unknown[]) => rateLimitFn(...a) }));
vi.mock("@/lib/workspace", () => ({ resolveGenerationContext: (...a: unknown[]) => resolveGenerationContextFn(...a) }));
vi.mock("@/lib/jobs/queue", () => ({ enqueueJob: (...a: unknown[]) => enqueueJobFn(...a) }));
vi.mock("@/lib/plans", () => ({ canUseUgc: (...a: unknown[]) => canUseUgcFn(...a) }));
vi.mock("@/lib/aspect-ratio", () => ({
  ASPECT_RATIOS: ["9:16", "1:1", "16:9"],
  canUseAspectRatio: (...a: unknown[]) => canUseAspectRatioFn(...a),
}));

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

function makeJsonRequest(body: Record<string, unknown>, opts?: { operationId?: string | null }): Request {
  const operationId = opts && "operationId" in opts ? opts.operationId : DEFAULT_OP_ID;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (operationId !== null) headers["Idempotency-Key"] = operationId as string;
  return new Request("https://forgecut.app/api/projects/ugc", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const validBody = { productName: "Glow Serum", sellingPoints: "Brightens skin in 2 weeks" };

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionFn.mockResolvedValue({ user: { id: "user-1" } });
  requireVerifiedEmailFn.mockResolvedValue(undefined);
  rateLimitFn.mockReturnValue({ ok: true });
  userFindUniqueOrThrow.mockResolvedValue({ plan: "creator" });
  resolveGenerationContextFn.mockResolvedValue({ creditOwnerId: "user-1", effectivePlan: "creator", workspaceId: null });
  canUseUgcFn.mockReturnValue(true);
  canUseAspectRatioFn.mockReturnValue(true);
  projectCreate.mockResolvedValue({ id: "proj-1" });
  jobCreate.mockResolvedValue({ id: "job-1" });
  creditReservationUpdate.mockResolvedValue({});
  releaseReservationFn.mockResolvedValue(undefined);
});

describe("POST /api/projects/ugc — idempotency", () => {
  it("no double charge: a genuinely new ad reserves once and creates one project", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "new", reservationId: "res-1" });

    const res = await POST(makeJsonRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ projectId: "proj-1" });
    expect(reserveGenerationCreditsFn).toHaveBeenCalledTimes(1);
    expect(reserveGenerationCreditsFn).toHaveBeenCalledWith(
      expect.objectContaining({ clientOperationId: DEFAULT_OP_ID })
    );
  });

  it("missing Idempotency-Key header is rejected with 400 before any reservation is attempted", async () => {
    const res = await POST(makeJsonRequest(validBody, { operationId: null }));

    expect(res.status).toBe(400);
    expect(reserveGenerationCreditsFn).not.toHaveBeenCalled();
  });

  it("duplicate identical request (same operation id): returns the existing project", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "in-flight", reservationId: "res-1", jobId: "job-1" });
    getProjectIdForJobFn.mockResolvedValue("proj-existing");

    const res = await POST(makeJsonRequest(validBody));
    const json = await res.json();

    expect(json).toEqual({ projectId: "proj-existing", duplicate: true });
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("concurrent duplicate request: the job-attach race loser returns the winner's project, never releases", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "new", reservationId: "res-1" });
    creditReservationUpdate.mockRejectedValue(new FakePrismaKnownRequestError("unique violation", { code: "P2002" }));
    creditReservationFindUnique.mockResolvedValue({ id: "res-1", jobId: "job-winner" });
    getProjectIdForJobFn.mockResolvedValue("proj-winner");

    const res = await POST(makeJsonRequest(validBody));
    const json = await res.json();

    expect(json).toEqual({ projectId: "proj-winner", duplicate: true });
    expect(releaseReservationFn).not.toHaveBeenCalled();
  });

  it("no double refund: a genuine failure releases exactly once", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "new", reservationId: "res-1" });
    projectCreate.mockRejectedValue(new Error("db unavailable"));

    await expect(POST(makeJsonRequest(validBody))).rejects.toThrow("db unavailable");

    expect(releaseReservationFn).toHaveBeenCalledTimes(1);
  });

  it("failed/released operation: a stale retry of an already-failed operation id is refused, not silently recharged", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "failed", reservationId: "res-1" });

    const res = await POST(makeJsonRequest(validBody, { operationId: "op-dead" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/already failed/i);
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("legitimate separate requests: two different products under two different operation ids both charge independently", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "new", reservationId: "res-1" });

    await POST(makeJsonRequest({ productName: "Serum A", sellingPoints: "x" }, { operationId: "op-a" }));
    await POST(makeJsonRequest({ productName: "Serum B", sellingPoints: "y" }, { operationId: "op-b" }));

    expect(reserveGenerationCreditsFn).toHaveBeenNthCalledWith(1, expect.objectContaining({ clientOperationId: "op-a" }));
    expect(reserveGenerationCreditsFn).toHaveBeenNthCalledWith(2, expect.objectContaining({ clientOperationId: "op-b" }));
  });

  it("new operation id + IDENTICAL content: still creates a NEW project and a NEW charge", async () => {
    reserveGenerationCreditsFn
      .mockResolvedValueOnce({ status: "new", reservationId: "res-1" })
      .mockResolvedValueOnce({ status: "new", reservationId: "res-2" });
    projectCreate.mockResolvedValueOnce({ id: "proj-1" }).mockResolvedValueOnce({ id: "proj-2" });
    jobCreate.mockResolvedValueOnce({ id: "job-1" }).mockResolvedValueOnce({ id: "job-2" });

    const res1 = await POST(makeJsonRequest(validBody, { operationId: "op-1st" }));
    const res2 = await POST(makeJsonRequest(validBody, { operationId: "op-2nd" }));

    expect(await res1.json()).toEqual({ projectId: "proj-1" });
    expect(await res2.json()).toEqual({ projectId: "proj-2" });
    expect(projectCreate).toHaveBeenCalledTimes(2);
  });

  it("workspace request: reservation keyed by requesting user, charged to the workspace owner", async () => {
    resolveGenerationContextFn.mockResolvedValue({ creditOwnerId: "owner-1", effectivePlan: "business", workspaceId: "ws-1" });
    reserveGenerationCreditsFn.mockResolvedValue({ status: "new", reservationId: "res-1" });

    await POST(makeJsonRequest(validBody));

    expect(reserveGenerationCreditsFn).toHaveBeenCalledWith(
      expect.objectContaining({ requestingUserId: "user-1", creditOwnerId: "owner-1", workspaceId: "ws-1" })
    );
  });

  it("workspace member retry: same member resubmitting the same operation id never double-charges the workspace", async () => {
    resolveGenerationContextFn.mockResolvedValue({ creditOwnerId: "owner-1", effectivePlan: "business", workspaceId: "ws-1" });
    reserveGenerationCreditsFn.mockResolvedValue({ status: "in-flight", reservationId: "res-1", jobId: "job-1" });
    getProjectIdForJobFn.mockResolvedValue("proj-existing");

    const res = await POST(makeJsonRequest(validBody, { operationId: "op-ws-retry" }));
    const json = await res.json();

    expect(json).toEqual({ projectId: "proj-existing", duplicate: true });
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("insufficient credits returns 402", async () => {
    reserveGenerationCreditsFn.mockRejectedValue(new FakeInsufficientCreditsError());

    const res = await POST(makeJsonRequest(validBody));

    expect(res.status).toBe(402);
    expect(projectCreate).not.toHaveBeenCalled();
  });
});
