import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSessionFn = vi.fn();
const rateLimitFn = vi.fn();
const featureVoteFindUnique = vi.fn();
const featureVoteDelete = vi.fn();
const featureVoteCreate = vi.fn();

const mockDb = {
  featureVote: {
    findUnique: (...a: unknown[]) => featureVoteFindUnique(...a),
    delete: (...a: unknown[]) => featureVoteDelete(...a),
    create: (...a: unknown[]) => featureVoteCreate(...a),
  },
};

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("next-auth", () => ({ getServerSession: (...a: unknown[]) => getServerSessionFn(...a) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...a: unknown[]) => rateLimitFn(...a) }));

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

const { POST } = await import("./route");

function makeRequest(): Request {
  return new Request("https://forgecut.app/api/roadmap/feat_1/vote", { method: "POST" });
}

const routeContext = { params: Promise.resolve({ id: "feat_1" }) };

// Regression coverage for a real bug: the create call's catch block used to
// swallow every error unconditionally and always report { voted: true },
// so a genuinely failed vote (DB timeout, connection drop, anything other
// than the feature request having been deleted) looked identical to a
// successful one from the client's perspective.
describe("POST /api/roadmap/[id]/vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionFn.mockResolvedValue({ user: { id: "user_1" } });
    rateLimitFn.mockReturnValue({ ok: true });
  });

  it("unvotes (deletes) when a vote already exists", async () => {
    featureVoteFindUnique.mockResolvedValue({ id: "vote_1" });
    const res = await POST(makeRequest(), routeContext);
    expect(featureVoteDelete).toHaveBeenCalledWith({ where: { id: "vote_1" } });
    expect(await res.json()).toEqual({ voted: false });
  });

  it("votes (creates) when no vote exists yet", async () => {
    featureVoteFindUnique.mockResolvedValue(null);
    featureVoteCreate.mockResolvedValue({ id: "vote_2" });
    const res = await POST(makeRequest(), routeContext);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voted: true });
  });

  it("returns a real 404 (not a false 'voted: true') when the feature request was deleted first", async () => {
    featureVoteFindUnique.mockResolvedValue(null);
    featureVoteCreate.mockRejectedValue(new FakePrismaKnownRequestError("FK violation", { code: "P2003" }));
    const res = await POST(makeRequest(), routeContext);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "This feature request no longer exists" });
  });

  it("propagates an unrelated database failure instead of silently reporting success", async () => {
    featureVoteFindUnique.mockResolvedValue(null);
    featureVoteCreate.mockRejectedValue(new Error("connection reset"));
    await expect(POST(makeRequest(), routeContext)).rejects.toThrow("connection reset");
  });
});
