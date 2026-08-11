import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSessionFn = vi.fn();
const requireVerifiedEmailFn = vi.fn();
const rateLimitFn = vi.fn();
const resolveGenerationContextFn = vi.fn();
const reserveGenerationCreditsFn = vi.fn();
const getProjectIdForJobFn = vi.fn();
const releaseReservationFn = vi.fn();
const enqueueJobFn = vi.fn();
const uploadBufferFn = vi.fn();
const canUseRepurposeFn = vi.fn();
const canUseAspectRatioFn = vi.fn();

const userFindUniqueOrThrow = vi.fn();
const projectCreate = vi.fn();
const projectUpdate = vi.fn();
const jobCreate = vi.fn();
const creditReservationUpdate = vi.fn();
const creditReservationFindUnique = vi.fn();

type MockDb = {
  user: { findUniqueOrThrow: (...a: unknown[]) => unknown };
  project: { create: (...a: unknown[]) => unknown; update: (...a: unknown[]) => unknown };
  job: { create: (...a: unknown[]) => unknown };
  creditReservation: {
    update: (...a: unknown[]) => unknown;
    findUnique: (...a: unknown[]) => unknown;
  };
  $transaction: (fn: (tx: MockDb) => Promise<unknown>) => Promise<unknown>;
};

const mockDb: MockDb = {
  user: { findUniqueOrThrow: (...a: unknown[]) => userFindUniqueOrThrow(...a) },
  project: { create: (...a: unknown[]) => projectCreate(...a), update: (...a: unknown[]) => projectUpdate(...a) },
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
vi.mock("@/lib/storage", () => ({ uploadBuffer: (...a: unknown[]) => uploadBufferFn(...a) }));
vi.mock("@/lib/plans", () => ({ canUseRepurpose: (...a: unknown[]) => canUseRepurposeFn(...a) }));
vi.mock("@/lib/aspect-ratio", () => ({
  isAspectRatio: (v: unknown) => typeof v === "string" && ["9:16", "1:1", "16:9"].includes(v),
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

function makeFormRequest(
  fields: Record<string, string>,
  file?: { name: string; type: string; content: string },
  opts?: { operationId?: string | null }
): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (file) form.append("file", new File([file.content], file.name, { type: file.type }));
  const operationId = opts && "operationId" in opts ? opts.operationId : DEFAULT_OP_ID;
  const headers: Record<string, string> = {};
  if (operationId !== null) headers["Idempotency-Key"] = operationId as string;
  return new Request("https://forgecut.app/api/projects/repurpose", { method: "POST", headers, body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionFn.mockResolvedValue({ user: { id: "user-1" } });
  requireVerifiedEmailFn.mockResolvedValue(undefined);
  rateLimitFn.mockReturnValue({ ok: true });
  userFindUniqueOrThrow.mockResolvedValue({ plan: "creator" });
  resolveGenerationContextFn.mockResolvedValue({ creditOwnerId: "user-1", effectivePlan: "creator", workspaceId: null });
  canUseRepurposeFn.mockReturnValue(true);
  canUseAspectRatioFn.mockReturnValue(true);
  projectCreate.mockResolvedValue({ id: "proj-1" });
  jobCreate.mockResolvedValue({ id: "job-1" });
  creditReservationUpdate.mockResolvedValue({});
  projectUpdate.mockResolvedValue({});
  uploadBufferFn.mockResolvedValue("https://cdn.example/source.mp4");
  releaseReservationFn.mockResolvedValue(undefined);
});

const validFields = { topic: "podcast highlights", durationSec: "120" };
const validFile = { name: "source.mp4", type: "video/mp4", content: "fake-video-bytes" };

describe("POST /api/projects/repurpose — idempotency", () => {
  it("no double charge: a genuinely new upload reserves once and creates one project", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "new", reservationId: "res-1" });

    const res = await POST(makeFormRequest(validFields, validFile));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ projectId: "proj-1" });
    expect(reserveGenerationCreditsFn).toHaveBeenCalledTimes(1);
    expect(reserveGenerationCreditsFn).toHaveBeenCalledWith(
      expect.objectContaining({ clientOperationId: DEFAULT_OP_ID })
    );
    expect(projectCreate).toHaveBeenCalledTimes(1);
  });

  it("missing Idempotency-Key header is rejected with 400 before any upload or reservation", async () => {
    const res = await POST(makeFormRequest(validFields, validFile, { operationId: null }));

    expect(res.status).toBe(400);
    expect(reserveGenerationCreditsFn).not.toHaveBeenCalled();
    expect(uploadBufferFn).not.toHaveBeenCalled();
  });

  it("duplicate identical request (same operation id): returns the existing project instead of re-uploading and re-charging", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "in-flight", reservationId: "res-1", jobId: "job-1" });
    getProjectIdForJobFn.mockResolvedValue("proj-existing");

    const res = await POST(makeFormRequest(validFields, validFile));
    const json = await res.json();

    expect(json).toEqual({ projectId: "proj-existing", duplicate: true });
    expect(projectCreate).not.toHaveBeenCalled();
    expect(uploadBufferFn).not.toHaveBeenCalled(); // no wasted upload for a known duplicate
  });

  it("concurrent duplicate request: losing the job-attach race returns the winner's project without releasing the reservation", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "new", reservationId: "res-1" });
    creditReservationUpdate.mockRejectedValue(new FakePrismaKnownRequestError("unique violation", { code: "P2002" }));
    creditReservationFindUnique.mockResolvedValue({ id: "res-1", jobId: "job-winner" });
    getProjectIdForJobFn.mockResolvedValue("proj-winner");

    const res = await POST(makeFormRequest(validFields, validFile));
    const json = await res.json();

    expect(json).toEqual({ projectId: "proj-winner", duplicate: true });
    expect(releaseReservationFn).not.toHaveBeenCalled();
  });

  it("no double refund: a genuine failure after reservation releases exactly once", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "new", reservationId: "res-1" });
    projectCreate.mockRejectedValue(new Error("db unavailable"));

    await expect(POST(makeFormRequest(validFields, validFile))).rejects.toThrow("db unavailable");

    expect(releaseReservationFn).toHaveBeenCalledTimes(1);
  });

  it("failed/released operation: a stale retry of an already-failed operation id is refused, not silently recharged", async () => {
    reserveGenerationCreditsFn.mockResolvedValue({ status: "failed", reservationId: "res-1" });

    const res = await POST(makeFormRequest(validFields, validFile, { operationId: "op-dead" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/already failed/i);
    expect(uploadBufferFn).not.toHaveBeenCalled();
  });

  it("legitimate separate requests: two different files under two different operation ids both charge and create their own project", async () => {
    reserveGenerationCreditsFn
      .mockResolvedValueOnce({ status: "new", reservationId: "res-1" })
      .mockResolvedValueOnce({ status: "new", reservationId: "res-2" });
    projectCreate.mockResolvedValueOnce({ id: "proj-1" }).mockResolvedValueOnce({ id: "proj-2" });
    jobCreate.mockResolvedValueOnce({ id: "job-1" }).mockResolvedValueOnce({ id: "job-2" });

    await POST(makeFormRequest(validFields, { ...validFile, name: "a.mp4" }, { operationId: "op-a" }));
    await POST(makeFormRequest(validFields, { ...validFile, name: "b.mp4" }, { operationId: "op-b" }));

    expect(reserveGenerationCreditsFn).toHaveBeenNthCalledWith(1, expect.objectContaining({ clientOperationId: "op-a" }));
    expect(reserveGenerationCreditsFn).toHaveBeenNthCalledWith(2, expect.objectContaining({ clientOperationId: "op-b" }));
  });

  it("new operation id + IDENTICAL file/content: still creates a NEW project and a NEW charge", async () => {
    reserveGenerationCreditsFn
      .mockResolvedValueOnce({ status: "new", reservationId: "res-1" })
      .mockResolvedValueOnce({ status: "new", reservationId: "res-2" });
    projectCreate.mockResolvedValueOnce({ id: "proj-1" }).mockResolvedValueOnce({ id: "proj-2" });
    jobCreate.mockResolvedValueOnce({ id: "job-1" }).mockResolvedValueOnce({ id: "job-2" });

    const res1 = await POST(makeFormRequest(validFields, validFile, { operationId: "op-1st" }));
    const res2 = await POST(makeFormRequest(validFields, validFile, { operationId: "op-2nd" }));

    expect((await res1.json())).toEqual({ projectId: "proj-1" });
    expect((await res2.json())).toEqual({ projectId: "proj-2" });
    expect(projectCreate).toHaveBeenCalledTimes(2);
  });

  it("workspace request: reservation is keyed by the requesting user, charge lands on the workspace owner", async () => {
    resolveGenerationContextFn.mockResolvedValue({ creditOwnerId: "owner-1", effectivePlan: "business", workspaceId: "ws-1" });
    reserveGenerationCreditsFn.mockResolvedValue({ status: "new", reservationId: "res-1" });

    await POST(makeFormRequest(validFields, validFile));

    expect(reserveGenerationCreditsFn).toHaveBeenCalledWith(
      expect.objectContaining({ requestingUserId: "user-1", creditOwnerId: "owner-1", workspaceId: "ws-1" })
    );
  });

  it("workspace member retry: same member resubmitting the same operation id never double-charges the workspace", async () => {
    resolveGenerationContextFn.mockResolvedValue({ creditOwnerId: "owner-1", effectivePlan: "business", workspaceId: "ws-1" });
    reserveGenerationCreditsFn.mockResolvedValue({ status: "in-flight", reservationId: "res-1", jobId: "job-1" });
    getProjectIdForJobFn.mockResolvedValue("proj-existing");

    const res = await POST(makeFormRequest(validFields, validFile, { operationId: "op-ws-retry" }));
    const json = await res.json();

    expect(json).toEqual({ projectId: "proj-existing", duplicate: true });
    expect(uploadBufferFn).not.toHaveBeenCalled();
  });

  it("insufficient credits returns 402 without touching storage", async () => {
    reserveGenerationCreditsFn.mockRejectedValue(new FakeInsufficientCreditsError());

    const res = await POST(makeFormRequest(validFields, validFile));

    expect(res.status).toBe(402);
    expect(uploadBufferFn).not.toHaveBeenCalled();
  });
});
