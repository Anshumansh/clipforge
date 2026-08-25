import { beforeEach, describe, expect, it, vi } from "vitest";

const getStoredObjectFn = vi.fn();
const headStoredObjectFn = vi.fn();

vi.mock("@/lib/storage", () => ({
  getStoredObject: (...args: unknown[]) => getStoredObjectFn(...args),
  headStoredObject: (...args: unknown[]) => headStoredObjectFn(...args),
}));

const { GET, HEAD } = await import("@/app/api/showcase/[name]/route");

function request(name: string, headers: Record<string, string> = {}) {
  return new Request(`https://forgecut.app/api/showcase/${name}`, { headers });
}

function routeContext(name: string) {
  return { params: Promise.resolve({ name }) };
}

describe("/api/showcase/[name]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SHOWCASE_SCRIPT_STORAGE_KEY;
    delete process.env.SHOWCASE_REPURPOSE_STORAGE_KEY;
    delete process.env.SHOWCASE_UGC_STORAGE_KEY;
    headStoredObjectFn.mockResolvedValue({
      contentType: "video/mp4",
      contentLength: 12345,
      etag: '"showcase-etag"',
      lastModified: new Date("2026-08-25T00:00:00Z"),
    });
    getStoredObjectFn.mockResolvedValue({
      body: new Uint8Array([0, 1, 2, 3]),
      contentType: "video/mp4",
      contentLength: 4,
      contentRange: null,
      etag: '"showcase-etag"',
      lastModified: new Date("2026-08-25T00:00:00Z"),
      status: 200,
    });
  });

  it.each(["script", "repurpose", "ugc"])("serves the allowlisted %s clip from authenticated storage", async (name) => {
    const response = await GET(request(name), routeContext(name));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(getStoredObjectFn).toHaveBeenCalledOnce();
  });

  it("supports browser byte-range requests", async () => {
    getStoredObjectFn.mockResolvedValueOnce({
      body: new Uint8Array([0, 1]),
      contentType: "video/mp4",
      contentLength: 2,
      contentRange: "bytes 0-1/12345",
      etag: '"showcase-etag"',
      lastModified: null,
      status: 206,
    });

    const response = await GET(request("script", { Range: "bytes=0-1" }), routeContext("script"));

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-1/12345");
    expect(response.headers.get("Content-Length")).toBe("2");
    expect(getStoredObjectFn).toHaveBeenCalledWith(expect.any(String), "bytes=0-1");
  });

  it("returns metadata without downloading the object for HEAD", async () => {
    const response = await HEAD(request("ugc"), routeContext("ugc"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("12345");
    expect(response.headers.get("ETag")).toBe('"showcase-etag"');
    expect(headStoredObjectFn).toHaveBeenCalledOnce();
    expect(getStoredObjectFn).not.toHaveBeenCalled();
  });

  it.each(["unknown", "..", "script/../../backups", ""])("fails closed for unrecognized name %j", async (name) => {
    const response = await GET(request("unknown"), routeContext(name));
    expect(response.status).toBe(404);
    expect(getStoredObjectFn).not.toHaveBeenCalled();
  });

  it("rejects malformed multi-range requests", async () => {
    const response = await GET(request("script", { Range: "bytes=0-1,4-5" }), routeContext("script"));
    expect(response.status).toBe(416);
    expect(getStoredObjectFn).not.toHaveBeenCalled();
  });

  it("returns 404 when the configured object is missing", async () => {
    getStoredObjectFn.mockResolvedValueOnce(null);
    const response = await GET(request("script"), routeContext("script"));
    expect(response.status).toBe(404);
  });

  it("returns 503 rather than leaking a storage error", async () => {
    getStoredObjectFn.mockRejectedValueOnce(new Error("provider credential details must not escape"));
    const response = await GET(request("script"), routeContext("script"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Showcase temporarily unavailable" });
  });

  it("returns 416 when storage rejects a valid but unsatisfiable range", async () => {
    getStoredObjectFn.mockRejectedValueOnce(new RangeError("outside object"));
    const response = await GET(request("script", { Range: "bytes=999999-" }), routeContext("script"));
    expect(response.status).toBe(416);
  });

  it("reads an environment-specific permanent key at request time", async () => {
    process.env.SHOWCASE_SCRIPT_STORAGE_KEY = "showcase/staging/v1/script.mp4";
    await GET(request("script"), routeContext("script"));
    expect(getStoredObjectFn).toHaveBeenCalledWith("showcase/staging/v1/script.mp4", undefined);
  });
});
