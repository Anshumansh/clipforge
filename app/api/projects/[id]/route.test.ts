import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveApiUserFn = vi.fn();
const projectAccessFilterFn = vi.fn();
const deleteMediaByPrefixFn = vi.fn();
const projectFindFirst = vi.fn();
const projectDelete = vi.fn();

const mockDb = {
  project: {
    findFirst: (...a: unknown[]) => projectFindFirst(...a),
    delete: (...a: unknown[]) => projectDelete(...a),
  },
};

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/api-auth", () => ({ resolveApiUser: (...a: unknown[]) => resolveApiUserFn(...a) }));
vi.mock("@/lib/workspace", () => ({ projectAccessFilter: (...a: unknown[]) => projectAccessFilterFn(...a) }));
vi.mock("@/lib/storage", () => ({ deleteMediaByPrefix: (...a: unknown[]) => deleteMediaByPrefixFn(...a) }));

const { GET, DELETE } = await import("./route");

function makeRequest(method = "GET"): Request {
  return new Request("https://forgecut.app/api/projects/proj_1", { method });
}

describe("GET /api/projects/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveApiUserFn.mockResolvedValue({ userId: "user_1" });
    projectAccessFilterFn.mockResolvedValue({ userId: "user_1" });
  });

  it("returns 401 with no session", async () => {
    resolveApiUserFn.mockResolvedValue(null);
    const res = await GET(makeRequest(), { params: { id: "proj_1" } });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the project isn't found or isn't accessible", async () => {
    projectFindFirst.mockResolvedValue(null);
    const res = await GET(makeRequest(), { params: { id: "proj_1" } });
    expect(res.status).toBe(404);
  });

  it("returns the project shape on success", async () => {
    projectFindFirst.mockResolvedValue({
      id: "proj_1",
      type: "script",
      title: "Test",
      status: "ready",
      videoUrl: "https://x/y.mp4",
      thumbnailUrl: null,
      scenesJson: null,
      errorMessage: null,
      clips: [],
      jobs: [{ status: "completed", progress: 100, log: "Done" }],
    });
    const res = await GET(makeRequest(), { params: { id: "proj_1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("proj_1");
    expect(body.job).toEqual({ status: "completed", progress: 100, log: "Done" });
  });
});

// Regression coverage for a real gap: there was previously no way to
// delete an individual project anywhere in the app (no route, no UI) --
// a failed generation, or just unwanted test data, had no cleanup path
// short of deleting the entire account.
describe("DELETE /api/projects/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveApiUserFn.mockResolvedValue({ userId: "user_1" });
    deleteMediaByPrefixFn.mockResolvedValue(undefined);
  });

  it("returns 401 with no session", async () => {
    resolveApiUserFn.mockResolvedValue(null);
    const res = await DELETE(makeRequest("DELETE"), { params: { id: "proj_1" } });
    expect(res.status).toBe(401);
  });

  it("returns 404 for a project owned by someone else -- does NOT use the broader workspace-membership filter GET uses", async () => {
    // Deliberately does not stub projectAccessFilter here: DELETE must
    // scope directly by userId, not via the workspace-viewer set.
    projectFindFirst.mockResolvedValue(null);
    const res = await DELETE(makeRequest("DELETE"), { params: { id: "proj_1" } });
    expect(res.status).toBe(404);
    expect(projectFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "proj_1", userId: "user_1" } })
    );
  });

  it("cleans up both storage key conventions, then deletes the row, on success", async () => {
    projectFindFirst.mockResolvedValue({
      id: "proj_1",
      userId: "user_1",
      jobs: [{ id: "job_1" }, { id: "job_2" }],
    });
    projectDelete.mockResolvedValue({});

    const res = await DELETE(makeRequest("DELETE"), { params: { id: "proj_1" } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteMediaByPrefixFn).toHaveBeenCalledWith("media/user_1/proj_1/");
    expect(deleteMediaByPrefixFn).toHaveBeenCalledWith("jobs/job_1/");
    expect(deleteMediaByPrefixFn).toHaveBeenCalledWith("jobs/job_2/");
    expect(projectDelete).toHaveBeenCalledWith({ where: { id: "proj_1" } });
  });

  it("still deletes the DB row even if storage cleanup fails", async () => {
    projectFindFirst.mockResolvedValue({ id: "proj_1", userId: "user_1", jobs: [] });
    deleteMediaByPrefixFn.mockRejectedValue(new Error("storage unavailable"));
    projectDelete.mockResolvedValue({});

    const res = await DELETE(makeRequest("DELETE"), { params: { id: "proj_1" } });

    expect(res.status).toBe(200);
    expect(projectDelete).toHaveBeenCalled();
  });
});
