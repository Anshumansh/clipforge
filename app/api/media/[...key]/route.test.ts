import { describe, it, expect, vi, beforeEach } from "vitest";

const getPresignedDownloadUrlFn = vi.fn();
vi.mock("@/lib/storage", () => ({
  getPresignedDownloadUrl: (...a: unknown[]) => getPresignedDownloadUrlFn(...a),
}));

const { GET } = await import("@/app/api/media/[...key]/route");

function makeRequest() {
  return new Request("https://forgecut.app/api/media/x");
}

describe("GET /api/media/[...key] -- allowed prefixes (post-deploy regression, item 9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPresignedDownloadUrlFn.mockResolvedValue("https://signed.example.com/x");
  });

  it("serves a legacy media/<userId>/... key (the original upload convention)", async () => {
    const res = await GET(makeRequest(), { params: { key: ["media", "user123", "final.mp4"] } });
    expect(res.status).toBe(307);
    expect(getPresignedDownloadUrlFn).toHaveBeenCalledWith("media/user123/final.mp4");
  });

  it("serves an attempt-scoped jobs/<jobId>/attempts/<token>/... key -- every render has used this convention since media-fencing shipped, and a real deploy 404'd on it until this route allowed the prefix", async () => {
    const res = await GET(makeRequest(), {
      params: { key: ["jobs", "job1", "attempts", "tok1", "output.mp4"] },
    });
    expect(res.status).toBe(307);
    expect(getPresignedDownloadUrlFn).toHaveBeenCalledWith("jobs/job1/attempts/tok1/output.mp4");
  });

  it("still blocks backups/... -- the exact security property OPERATIONS.md section 17 fixed must survive adding the jobs/ prefix", async () => {
    const res = await GET(makeRequest(), { params: { key: ["backups", "db-20260101.sql.gz"] } });
    expect(res.status).toBe(404);
    expect(getPresignedDownloadUrlFn).not.toHaveBeenCalled();
  });

  it("blocks any other unrecognized top-level prefix", async () => {
    const res = await GET(makeRequest(), { params: { key: ["etc", "passwd"] } });
    expect(res.status).toBe(404);
    expect(getPresignedDownloadUrlFn).not.toHaveBeenCalled();
  });

  it("returns 404 when the key doesn't resolve to a real object", async () => {
    getPresignedDownloadUrlFn.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), { params: { key: ["media", "user123", "missing.mp4"] } });
    expect(res.status).toBe(404);
  });
});
