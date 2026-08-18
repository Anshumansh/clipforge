import { describe, it, expect, vi } from "vitest";

// Mocks — declared before the module import so vi.mock hoisting works.
vi.mock("@remotion/bundler", () => ({ bundle: vi.fn() }));
vi.mock("@remotion/renderer", () => ({ renderMedia: vi.fn(), renderStill: vi.fn(), selectComposition: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  uploadLocalFile: vi.fn(),
  getAppBaseUrl: () => "https://forgecut.app",
  getPresignedDownloadUrl: vi.fn(async (key: string) => `https://storage.example/${key}?sig=presigned`),
}));

const { resolveInternalMediaUrls } = await import("./remotion-render");
const { getPresignedDownloadUrl } = await import("@/lib/storage");

describe("resolveInternalMediaUrls", () => {
  it("swaps an /api/media app URL for a presigned storage URL", async () => {
    const result = await resolveInternalMediaUrls({
      voiceoverUrl: "https://forgecut.app/api/media/media/user123/proj456/voiceover.mp3",
    });

    expect(result.voiceoverUrl).toBe("https://storage.example/media/user123/proj456/voiceover.mp3?sig=presigned");
    expect(getPresignedDownloadUrl).toHaveBeenCalledWith("media/user123/proj456/voiceover.mp3");
  });

  it("leaves unrelated strings and other domains untouched", async () => {
    const result = await resolveInternalMediaUrls({
      topic: "morning routines",
      externalUrl: "https://i.ytimg.com/vi/abc/default.jpg",
      count: 3,
      enabled: true,
      nothing: null,
    });

    expect(result).toEqual({
      topic: "morning routines",
      externalUrl: "https://i.ytimg.com/vi/abc/default.jpg",
      count: 3,
      enabled: true,
      nothing: null,
    });
  });

  it("resolves URLs nested inside arrays and objects (e.g. a b-roll scene timeline)", async () => {
    const result = await resolveInternalMediaUrls({
      scenes: [
        { keyword: "sunrise", mediaUrl: "https://forgecut.app/api/media/media/user123/proj456/broll-0.mp4" },
        { keyword: "coffee", mediaUrl: "https://forgecut.app/api/media/media/user123/proj456/broll-1.mp4" },
      ],
      brand: { logoUrl: "https://forgecut.app/api/media/media/user123/brand/logo.png" },
    });

    expect(result.scenes[0].mediaUrl).toBe("https://storage.example/media/user123/proj456/broll-0.mp4?sig=presigned");
    expect(result.scenes[1].mediaUrl).toBe("https://storage.example/media/user123/proj456/broll-1.mp4?sig=presigned");
    expect(result.brand.logoUrl).toBe("https://storage.example/media/user123/brand/logo.png?sig=presigned");
  });

  it("falls back to the original URL when presigning is unavailable (local dev, no STORAGE_* configured)", async () => {
    vi.mocked(getPresignedDownloadUrl).mockResolvedValueOnce(null);

    const result = await resolveInternalMediaUrls({
      voiceoverUrl: "https://forgecut.app/api/media/media/user123/proj456/voiceover.mp3",
    });

    expect(result.voiceoverUrl).toBe("https://forgecut.app/api/media/media/user123/proj456/voiceover.mp3");
  });
});
