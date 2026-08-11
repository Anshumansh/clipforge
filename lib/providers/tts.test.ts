import { describe, it, expect, vi, afterEach } from "vitest";

// ------------------------------------------------------------------
// Mocks — declared before the module import so vi.mock hoisting works.
// ------------------------------------------------------------------

// Make Edge TTS always fail so we can test the all-providers-failed path.
vi.mock("msedge-tts", () => ({
  MsEdgeTTS: class {
    async setMetadata() {
      throw new Error("Edge TTS network error (mocked)");
    }
    close() {}
  },
  OUTPUT_FORMAT: { AUDIO_24KHZ_96KBITRATE_MONO_MP3: "audio-24khz-96kbitrate-mono-mp3" },
}));

// Prevent real filesystem operations inside synthesizeWithEdge.
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn().mockResolvedValue("/tmp/tts-test"),
  readFile: vi.fn(),
  rm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/storage", () => ({ uploadBuffer: vi.fn() }));
vi.mock("music-metadata", () => ({ parseBuffer: vi.fn() }));
vi.mock("@/lib/languages", () => ({
  getLanguage: vi.fn().mockReturnValue({
    code: "en",
    label: "English",
    maleVoice: "en-US-GuyNeural",
    femaleVoice: "en-US-JennyNeural",
  }),
}));

const { synthesizeVoiceover } = await import("@/lib/providers/tts");

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("synthesizeVoiceover — all-providers-fail behaviour", () => {
  const savedKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    // Restore original env variable after each test.
    if (savedKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = savedKey;
    }
  });

  it("throws instead of returning a silent mock when all TTS providers fail", async () => {
    // Skip the OpenAI path — only Edge TTS runs, and it throws (mocked above).
    delete process.env.OPENAI_API_KEY;

    await expect(
      synthesizeVoiceover("Hello world", "media/user-1/proj-1", "alloy", false, "en")
    ).rejects.toThrow();
  });

  it("throws with a descriptive message when Edge TTS fails", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(
      synthesizeVoiceover("Hello world", "media/user-1/proj-1")
    ).rejects.toThrow(/TTS providers failed/);
  });
});
