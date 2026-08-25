import { describe, it, expect, vi, beforeEach } from "vitest";

const getPresignedDownloadUrlFn = vi.fn();
vi.mock("@/lib/storage", () => ({
  getPresignedDownloadUrl: (...a: unknown[]) => getPresignedDownloadUrlFn(...a),
}));

const resolveApiUserFn = vi.fn();
vi.mock("@/lib/api-auth", () => ({
  resolveApiUser: (...a: unknown[]) => resolveApiUserFn(...a),
}));

const projectAccessFilterFn = vi.fn();
vi.mock("@/lib/workspace", () => ({
  projectAccessFilter: (...a: unknown[]) => projectAccessFilterFn(...a),
}));

const getDemoUserIdFn = vi.fn();
vi.mock("@/lib/demo-user", () => ({
  getDemoUserId: (...a: unknown[]) => getDemoUserIdFn(...a),
}));

const isValidInternalMediaSecretFn = vi.fn();
vi.mock("@/lib/internal-auth", () => ({
  isValidInternalMediaSecret: (...a: unknown[]) => isValidInternalMediaSecretFn(...a),
}));

const jobFindUnique = vi.fn();
const projectFindUnique = vi.fn();
const projectFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    job: { findUnique: (...a: unknown[]) => jobFindUnique(...a) },
    project: {
      findUnique: (...a: unknown[]) => projectFindUnique(...a),
      findFirst: (...a: unknown[]) => projectFindFirst(...a),
    },
  },
}));

const { GET } = await import("@/app/api/media/[...key]/route");

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("https://forgecut.app/api/media/x", { headers });
}

function routeContext(key: string[]) {
  return { params: Promise.resolve({ key }) };
}

const DEMO_USER_ID = "demo-user-1";
const OWNER_USER_ID = "owner-user-1";
const OTHER_USER_ID = "other-user-1";
const PROJECT_ID = "project-1";
const WORKSPACE_ID = "workspace-1";
const JOB_ID = "job-1";
const ATTEMPT_TOKEN = "22222222-2222-2222-2222-222222222222";

describe("GET /api/media/[...key] -- authorization (P0 security pass)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPresignedDownloadUrlFn.mockResolvedValue("https://signed.b2.example.com/x?X-Amz-Signature=deadbeef");
    isValidInternalMediaSecretFn.mockReturnValue(false);
    getDemoUserIdFn.mockResolvedValue(DEMO_USER_ID);
    resolveApiUserFn.mockResolvedValue(null);
    projectAccessFilterFn.mockResolvedValue({ userId: OWNER_USER_ID });
    jobFindUnique.mockResolvedValue({ projectId: PROJECT_ID });
    projectFindUnique.mockResolvedValue({ id: PROJECT_ID, userId: OWNER_USER_ID, workspaceId: null });
    projectFindFirst.mockResolvedValue(null);
  });

  describe("ownership is resolved through the database, not trusted from the path", () => {
    it("the owner can access their own job-attempt-scoped media", async () => {
      resolveApiUserFn.mockResolvedValue({ userId: OWNER_USER_ID, plan: "free", viaApiKey: false });
      projectFindFirst.mockResolvedValue({ id: PROJECT_ID });

      const res = await GET(makeRequest(), routeContext(["jobs", JOB_ID, "attempts", ATTEMPT_TOKEN, "output.mp4"]));

      expect(res.status).toBe(307);
      // The authorization check hit the DB for the real Job -> Project ->
      // User chain -- it never took the attemptToken itself as proof.
      expect(jobFindUnique).toHaveBeenCalledWith({ where: { id: JOB_ID }, select: { projectId: true } });
      expect(projectFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: PROJECT_ID }) })
      );
    });

    it("the owner can access their own legacy media/<userId>/<projectId>/... key, verified against the DB record for that project rather than the path segment", async () => {
      resolveApiUserFn.mockResolvedValue({ userId: OWNER_USER_ID, plan: "free", viaApiKey: false });
      projectFindFirst.mockResolvedValue({ id: PROJECT_ID });

      const res = await GET(makeRequest(), routeContext(["media", OWNER_USER_ID, PROJECT_ID, "final.mp4"]));

      expect(res.status).toBe(307);
      expect(projectFindUnique).toHaveBeenCalledWith({
        where: { id: PROJECT_ID },
        select: { id: true, userId: true },
      });
    });

    it("rejects a legacy key whose path userId doesn't match the project's real owner in the DB -- the path claim alone is never trusted", async () => {
      resolveApiUserFn.mockResolvedValue({ userId: OWNER_USER_ID, plan: "free", viaApiKey: false });
      projectFindUnique.mockResolvedValue({ id: PROJECT_ID, userId: OWNER_USER_ID, workspaceId: null });

      // Path claims the file belongs to OTHER_USER_ID, but the DB says the
      // project is really owned by OWNER_USER_ID -- inconsistent, reject.
      const res = await GET(makeRequest(), routeContext(["media", OTHER_USER_ID, PROJECT_ID, "final.mp4"]));

      expect(res.status).toBe(404);
    });
  });

  describe("workspace sharing", () => {
    it("an authorized workspace member can access another member's project media", async () => {
      const memberUserId = "workspace-member-1";
      projectFindUnique.mockResolvedValue({ id: PROJECT_ID, userId: OWNER_USER_ID, workspaceId: WORKSPACE_ID });
      resolveApiUserFn.mockResolvedValue({ userId: memberUserId, plan: "free", viaApiKey: false });
      projectAccessFilterFn.mockResolvedValue({ OR: [{ userId: memberUserId }, { workspaceId: WORKSPACE_ID }] });
      projectFindFirst.mockResolvedValue({ id: PROJECT_ID }); // member's access filter matches via workspaceId

      const res = await GET(makeRequest(), routeContext(["jobs", JOB_ID, "attempts", ATTEMPT_TOKEN, "output.mp4"]));

      expect(res.status).toBe(307);
      expect(projectAccessFilterFn).toHaveBeenCalledWith(memberUserId);
    });
  });

  describe("cross-user and anonymous access is blocked", () => {
    it("User A cannot access User B's private job media", async () => {
      resolveApiUserFn.mockResolvedValue({ userId: OTHER_USER_ID, plan: "free", viaApiKey: false });
      projectAccessFilterFn.mockResolvedValue({ userId: OTHER_USER_ID }); // no workspace overlap
      projectFindFirst.mockResolvedValue(null); // access-filtered lookup finds nothing for User A

      const res = await GET(makeRequest(), routeContext(["jobs", JOB_ID, "attempts", ATTEMPT_TOKEN, "output.mp4"]));

      expect(res.status).toBe(404);
      expect(getPresignedDownloadUrlFn).not.toHaveBeenCalled();
    });

    it("an anonymous (unauthenticated) request cannot access a real user's private media", async () => {
      resolveApiUserFn.mockResolvedValue(null); // no session, no API key

      const res = await GET(makeRequest(), routeContext(["jobs", JOB_ID, "attempts", ATTEMPT_TOKEN, "output.mp4"]));

      expect(res.status).toBe(404);
      expect(getPresignedDownloadUrlFn).not.toHaveBeenCalled();
    });
  });

  describe("demo media access policy", () => {
    it("demo-generated media (owned by the shared anonymous-demo account) is reachable with no session at all -- documented policy: matches the homepage try-before-signup design", async () => {
      projectFindUnique.mockResolvedValue({ id: PROJECT_ID, userId: DEMO_USER_ID, workspaceId: null });
      resolveApiUserFn.mockResolvedValue(null); // still anonymous

      const res = await GET(makeRequest(), routeContext(["jobs", JOB_ID, "attempts", ATTEMPT_TOKEN, "output.mp4"]));

      expect(res.status).toBe(307);
      // No project-access-filter DB round trip needed for the demo path --
      // it's allow-by-owner-identity, not allow-by-membership.
      expect(projectFindFirst).not.toHaveBeenCalled();
    });
  });

  describe("prefix and shape validation still holds", () => {
    it("blocks backups/... regardless of authorization state", async () => {
      resolveApiUserFn.mockResolvedValue({ userId: OWNER_USER_ID, plan: "free", viaApiKey: false });

      const res = await GET(makeRequest(), routeContext(["backups", "db-20260101.sql.gz"]));

      expect(res.status).toBe(404);
      expect(getPresignedDownloadUrlFn).not.toHaveBeenCalled();
    });

    it("blocks an arbitrary/unknown top-level prefix", async () => {
      const res = await GET(makeRequest(), routeContext(["etc", "passwd"]));
      expect(res.status).toBe(404);
    });

    it("blocks a malformed jobs/ key that doesn't match the exact attempt-scoped shape", async () => {
      const res = await GET(makeRequest(), routeContext(["jobs", JOB_ID, "output.mp4"]));
      expect(res.status).toBe(404);
      expect(jobFindUnique).not.toHaveBeenCalled();
    });

    it("rejects a literal .. path-traversal segment even though it carries an allowed prefix", async () => {
      const res = await GET(makeRequest(), routeContext(["media", "..", "..", "backups", "db-20260101.sql.gz"]));
      expect(res.status).toBe(404);
      expect(getPresignedDownloadUrlFn).not.toHaveBeenCalled();
    });

    it("rejects an empty path segment (e.g. from a double slash / double-encoded separator)", async () => {
      const res = await GET(makeRequest(), routeContext(["media", OWNER_USER_ID, "", "final.mp4"]));
      expect(res.status).toBe(404);
    });

    it("rejects a single '.' segment", async () => {
      const res = await GET(makeRequest(), routeContext(["media", OWNER_USER_ID, ".", "final.mp4"]));
      expect(res.status).toBe(404);
    });

    it("returns 404 when the key resolves and is authorized but no object actually exists at that key", async () => {
      resolveApiUserFn.mockResolvedValue({ userId: OWNER_USER_ID, plan: "free", viaApiKey: false });
      projectFindFirst.mockResolvedValue({ id: PROJECT_ID });
      getPresignedDownloadUrlFn.mockResolvedValueOnce(null);

      const res = await GET(makeRequest(), routeContext(["media", OWNER_USER_ID, PROJECT_ID, "missing.mp4"]));
      expect(res.status).toBe(404);
    });
  });

  describe("internal (worker) service-to-service access", () => {
    it("a valid internal-media-secret header bypasses per-user authorization entirely -- the worker fetching its own job's source media has no session to present", async () => {
      isValidInternalMediaSecretFn.mockReturnValue(true);

      const res = await GET(
        makeRequest({ "x-internal-media-secret": "whatever-was-configured" }),
        routeContext(["media", OWNER_USER_ID, PROJECT_ID, "source.mp4"])
      );

      expect(res.status).toBe(307);
      expect(resolveApiUserFn).not.toHaveBeenCalled();
    });

    it("an invalid internal-media-secret header is not treated as valid -- falls through to normal per-user authorization and is rejected the same as no header at all", async () => {
      isValidInternalMediaSecretFn.mockReturnValue(false);
      resolveApiUserFn.mockResolvedValue(null);

      const res = await GET(
        makeRequest({ "x-internal-media-secret": "wrong" }),
        routeContext(["jobs", JOB_ID, "attempts", ATTEMPT_TOKEN, "output.mp4"])
      );

      expect(res.status).toBe(404);
    });
  });

  describe("brand-kit logo (user-scoped, not project-scoped)", () => {
    it("the owning user can access their own brand logo", async () => {
      resolveApiUserFn.mockResolvedValue({ userId: OWNER_USER_ID, plan: "free", viaApiKey: false });

      const res = await GET(makeRequest(), routeContext(["media", OWNER_USER_ID, "brand", "logo-123.png"]));

      expect(res.status).toBe(307);
    });

    it("a different logged-in user cannot access someone else's brand logo", async () => {
      resolveApiUserFn.mockResolvedValue({ userId: OTHER_USER_ID, plan: "free", viaApiKey: false });

      const res = await GET(makeRequest(), routeContext(["media", OWNER_USER_ID, "brand", "logo-123.png"]));

      expect(res.status).toBe(404);
    });
  });

  describe("presigned redirect does not leak credentials", () => {
    it("the redirect target is the signed URL from getPresignedDownloadUrl and never contains the raw storage secret key as a literal substring", async () => {
      resolveApiUserFn.mockResolvedValue({ userId: OWNER_USER_ID, plan: "free", viaApiKey: false });
      projectFindFirst.mockResolvedValue({ id: PROJECT_ID });
      const rawSecretLookalike = "STORAGE_SECRET_ACCESS_KEY_VALUE_SHOULD_NEVER_APPEAR";
      getPresignedDownloadUrlFn.mockResolvedValueOnce("https://signed.b2.example.com/x?X-Amz-Signature=deadbeef");

      const res = await GET(makeRequest(), routeContext(["media", OWNER_USER_ID, PROJECT_ID, "final.mp4"]));

      expect(res.status).toBe(307);
      const location = res.headers.get("location") ?? "";
      expect(location).not.toContain(rawSecretLookalike);
      // A real presigned URL is signature-based (HMAC), not the secret key
      // itself in the URL -- assert the redirect is exactly what the signer
      // returned, not something this route further modified or leaked into.
      expect(location).toBe("https://signed.b2.example.com/x?X-Amz-Signature=deadbeef");
    });
  });
});
