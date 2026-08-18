import { describe, it, expect, vi } from "vitest";

// Mocks — declared before the module import so vi.mock hoisting works.
vi.mock("@remotion/bundler", () => ({ bundle: vi.fn() }));
vi.mock("@remotion/renderer", () => ({ renderMedia: vi.fn(), renderStill: vi.fn(), selectComposition: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  uploadLocalFile: vi.fn(),
  getAppBaseUrl: () => "https://forgecut.app",
  getPresignedDownloadUrl: vi.fn(async (key: string) => `https://storage.example/${key}?sig=presigned`),
}));

const findUniqueJobMock = vi.fn();
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: (...a: unknown[]) => findUniqueJobMock(...a) } } }));

const validateExternalAssetUrlMock = vi.fn();
vi.mock("@/lib/asset-url-security", () => ({
  validateExternalAssetUrl: (...a: unknown[]) => validateExternalAssetUrlMock(...a),
}));

const { resolveInternalMediaUrls } = await import("./remotion-render");
const { getPresignedDownloadUrl } = await import("@/lib/storage");

const OWNER = "user123";
const OTHER_USER = "user999";

describe("resolveInternalMediaUrls", () => {
  it("swaps an /api/media app URL for a presigned storage URL when the key's owner matches the expected user", async () => {
    const result = await resolveInternalMediaUrls(
      { voiceoverUrl: `https://forgecut.app/api/media/media/${OWNER}/proj456/voiceover.mp3` },
      OWNER
    );

    expect(result.voiceoverUrl).toBe(`https://storage.example/media/${OWNER}/proj456/voiceover.mp3?sig=presigned`);
    expect(getPresignedDownloadUrl).toHaveBeenCalledWith(`media/${OWNER}/proj456/voiceover.mp3`);
  });

  it("leaves plain non-URL strings untouched (never sent to any validator)", async () => {
    const result = await resolveInternalMediaUrls(
      { topic: "morning routines", count: 3, enabled: true, nothing: null },
      OWNER
    );

    expect(result).toEqual({ topic: "morning routines", count: 3, enabled: true, nothing: null });
    expect(validateExternalAssetUrlMock).not.toHaveBeenCalled();
  });

  describe("external (non-Clipforge) URLs", () => {
    it("delegates a URL-shaped string that isn't our own media route to the SSRF-safe validator", async () => {
      validateExternalAssetUrlMock.mockResolvedValueOnce("https://images.pexels.com/photos/1/x.jpeg");

      const result = await resolveInternalMediaUrls(
        { mediaUrl: "https://images.pexels.com/photos/1/x.jpeg" },
        OWNER
      );

      expect(validateExternalAssetUrlMock).toHaveBeenCalledWith("https://images.pexels.com/photos/1/x.jpeg");
      expect(result.mediaUrl).toBe("https://images.pexels.com/photos/1/x.jpeg");
    });

    it("propagates rejection from the validator instead of silently passing an unsafe URL through", async () => {
      validateExternalAssetUrlMock.mockRejectedValueOnce(new Error("Blocked asset host (resolves to a non-public address)"));

      await expect(
        resolveInternalMediaUrls({ mediaUrl: "https://images.pexels.com/redirect-to-metadata" }, OWNER)
      ).rejects.toThrow(/Blocked asset host/);
    });
  });

  it("resolves URLs nested inside arrays and objects (e.g. a b-roll scene timeline)", async () => {
    const result = await resolveInternalMediaUrls(
      {
        scenes: [
          { keyword: "sunrise", mediaUrl: `https://forgecut.app/api/media/media/${OWNER}/proj456/broll-0.mp4` },
          { keyword: "coffee", mediaUrl: `https://forgecut.app/api/media/media/${OWNER}/proj456/broll-1.mp4` },
        ],
        brand: { logoUrl: `https://forgecut.app/api/media/media/${OWNER}/brand/logo.png` },
      },
      OWNER
    );

    expect(result.scenes[0].mediaUrl).toBe(`https://storage.example/media/${OWNER}/proj456/broll-0.mp4?sig=presigned`);
    expect(result.scenes[1].mediaUrl).toBe(`https://storage.example/media/${OWNER}/proj456/broll-1.mp4?sig=presigned`);
    expect(result.brand.logoUrl).toBe(`https://storage.example/media/${OWNER}/brand/logo.png?sig=presigned`);
  });

  it("falls back to the original URL when presigning is unavailable (local dev, no STORAGE_* configured)", async () => {
    vi.mocked(getPresignedDownloadUrl).mockResolvedValueOnce(null);

    const result = await resolveInternalMediaUrls(
      { voiceoverUrl: `https://forgecut.app/api/media/media/${OWNER}/proj456/voiceover.mp3` },
      OWNER
    );

    expect(result.voiceoverUrl).toBe(`https://forgecut.app/api/media/media/${OWNER}/proj456/voiceover.mp3`);
  });

  describe("ownership scoping (security)", () => {
    it("refuses to presign a media/{userId}/... key belonging to a different user", async () => {
      vi.mocked(getPresignedDownloadUrl).mockClear();

      const maliciousUrl = `https://forgecut.app/api/media/media/${OTHER_USER}/their-project/voiceover.mp3`;
      const result = await resolveInternalMediaUrls({ voiceoverUrl: maliciousUrl }, OWNER);

      // Left exactly as the untrusted app URL -- never presigned, so it falls
      // through to /api/media's own real ownership check (a 404 for anyone
      // but user999), never a working link handed to Remotion.
      expect(result.voiceoverUrl).toBe(maliciousUrl);
      expect(getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it("refuses to presign when there is no expected owner at all (e.g. thumbnail render with no scoping context)", async () => {
      vi.mocked(getPresignedDownloadUrl).mockClear();

      const url = `https://forgecut.app/api/media/media/${OWNER}/proj456/voiceover.mp3`;
      const result = await resolveInternalMediaUrls({ voiceoverUrl: url }, null);

      expect(result.voiceoverUrl).toBe(url);
      expect(getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it("resolves a jobs/{jobId}/attempts/... output key by looking up the job's real owner", async () => {
      findUniqueJobMock.mockResolvedValueOnce({ userId: OWNER });

      const url = "https://forgecut.app/api/media/jobs/job-abc/attempts/token-1/output.mp4";
      const result = await resolveInternalMediaUrls({ videoUrl: url }, OWNER);

      expect(findUniqueJobMock).toHaveBeenCalledWith({ where: { id: "job-abc" }, select: { userId: true } });
      expect(result.videoUrl).toBe("https://storage.example/jobs/job-abc/attempts/token-1/output.mp4?sig=presigned");
    });

    it("refuses to presign a jobs/{jobId}/... key belonging to a different job's owner", async () => {
      vi.mocked(getPresignedDownloadUrl).mockClear();
      findUniqueJobMock.mockResolvedValueOnce({ userId: OTHER_USER });

      const url = "https://forgecut.app/api/media/jobs/someone-elses-job/attempts/token-1/output.mp4";
      const result = await resolveInternalMediaUrls({ videoUrl: url }, OWNER);

      expect(result.videoUrl).toBe(url);
      expect(getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it("refuses to presign a key that doesn't match any recognized shape", async () => {
      vi.mocked(getPresignedDownloadUrl).mockClear();

      const url = "https://forgecut.app/api/media/backups/whatever.sql";
      const result = await resolveInternalMediaUrls({ someUrl: url }, OWNER);

      expect(result.someUrl).toBe(url);
      expect(getPresignedDownloadUrl).not.toHaveBeenCalled();
    });
  });
});
