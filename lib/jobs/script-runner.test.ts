import { describe, it, expect, vi, beforeEach } from "vitest";

// ------------------------------------------------------------------
// Mocks
// ------------------------------------------------------------------

const jobFindUnique = vi.fn();
const jobUpdate = vi.fn();
const projectUpdate = vi.fn();
const reservationFindUnique = vi.fn();
const costRecordUpsert = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    job: {
      findUniqueOrThrow: (...a: unknown[]) => jobFindUnique(...a),
      update: (...a: unknown[]) => jobUpdate(...a),
    },
    project: { update: (...a: unknown[]) => projectUpdate(...a) },
    creditReservation: { findUnique: (...a: unknown[]) => reservationFindUnique(...a) },
  },
}));

const captureReservationFn = vi.fn();
const releaseReservationFn = vi.fn();

vi.mock("@/lib/pricing/ledger", () => ({
  captureReservation: (...a: unknown[]) => captureReservationFn(...a),
  releaseReservation: (...a: unknown[]) => releaseReservationFn(...a),
}));

const refundCreditsFn = vi.fn();

vi.mock("@/lib/credits", () => ({
  refundCredits: (...a: unknown[]) => refundCreditsFn(...a),
  CREDITS_PER_VIDEO: 10,
}));

const generateScriptFn = vi.fn();
vi.mock("@/lib/providers/script", () => ({
  generateScript: (...a: unknown[]) => generateScriptFn(...a),
}));

const synthesizeVoiceoverFn = vi.fn();
vi.mock("@/lib/providers/tts", () => ({
  synthesizeVoiceover: (...a: unknown[]) => synthesizeVoiceoverFn(...a),
}));

const cloneVoiceFn = vi.fn();
vi.mock("@/lib/providers/voice-clone", () => ({
  cloneVoice: (...a: unknown[]) => cloneVoiceFn(...a),
}));

const pickBrollFn = vi.fn();
vi.mock("@/lib/providers/broll", () => ({
  pickBrollScenes: (...a: unknown[]) => pickBrollFn(...a),
}));

const renderScriptVideoFn = vi.fn();
vi.mock("@/lib/remotion-render", () => ({
  renderScriptVideo: (...a: unknown[]) => renderScriptVideoFn(...a),
}));

vi.mock("@/lib/streaks", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/brand-server", () => ({ getBrandForRender: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/timeline", () => ({ computeSceneTimeline: vi.fn().mockReturnValue([]) }));
vi.mock("@/lib/languages", () => ({ getLanguage: vi.fn().mockReturnValue({ code: "en", label: "English" }) }));

vi.mock("@/lib/workspace", () => ({
  resolveProjectCreditOwnerId: vi.fn().mockResolvedValue("user-1"),
}));

vi.mock("@/lib/jobs/cost-tracker", () => ({
  upsertCostRecord: (...a: unknown[]) => costRecordUpsert(...a),
}));

const { runScriptJob } = await import("@/lib/jobs/script-runner");

// ------------------------------------------------------------------
// Test fixtures
// ------------------------------------------------------------------

function makeJob(overrides = {}) {
  return {
    id: "job-1",
    project: {
      id: "proj-1",
      userId: "user-1",
      workspaceId: null,
      input: JSON.stringify({ topic: "test topic", watermark: false }),
      title: "Test project",
      user: { id: "user-1" },
    },
    ...overrides,
  };
}

const mockScript = {
  title: "Test Script",
  script: "Hello world",
  sceneKeywords: ["test"],
  provider: "openai" as const,
  inputTokens: 50,
  outputTokens: 100,
};

const mockVoiceover = {
  audioUrl: "https://b2.example.com/audio.mp3",
  durationSec: 30,
  words: [],
  mocked: false,
  provider: "openai" as const,
  characterCount: 11,
};

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("runScriptJob — script runner (TEST-001 + REL-001 + COST-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobFindUnique.mockResolvedValue(makeJob());
    jobUpdate.mockResolvedValue({});
    projectUpdate.mockResolvedValue({});
    generateScriptFn.mockResolvedValue(mockScript);
    pickBrollFn.mockResolvedValue([]);
    synthesizeVoiceoverFn.mockResolvedValue(mockVoiceover);
    renderScriptVideoFn.mockResolvedValue("https://b2.example.com/final.mp4");
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });
    captureReservationFn.mockResolvedValue(undefined);
    releaseReservationFn.mockResolvedValue(undefined);
    refundCreditsFn.mockResolvedValue(undefined);
    costRecordUpsert.mockResolvedValue(undefined);
  });

  it("captures the reservation on successful completion (credits settled, not refunded)", async () => {
    await runScriptJob("job-1");

    expect(captureReservationFn).toHaveBeenCalledWith("res-1");
    expect(releaseReservationFn).not.toHaveBeenCalled();
    expect(refundCreditsFn).not.toHaveBeenCalled();
  });

  it("marks project and job as done on success", async () => {
    await runScriptJob("job-1");

    expect(projectUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ready" }) }));
    expect(jobUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "done" }) }));
  });

  it("releases the reservation (not refundCredits) when LLM fails — idempotent refund", async () => {
    generateScriptFn.mockRejectedValue(new Error("LLM timeout"));

    await runScriptJob("job-1");

    expect(releaseReservationFn).toHaveBeenCalledWith("res-1", expect.any(String));
    expect(captureReservationFn).not.toHaveBeenCalled();
    expect(refundCreditsFn).not.toHaveBeenCalled();
  });

  it("releases the reservation when TTS fails", async () => {
    synthesizeVoiceoverFn.mockRejectedValue(new Error("All TTS providers failed"));

    await runScriptJob("job-1");

    expect(releaseReservationFn).toHaveBeenCalledWith("res-1", expect.any(String));
    expect(captureReservationFn).not.toHaveBeenCalled();
  });

  it("releases the reservation when render fails", async () => {
    renderScriptVideoFn.mockRejectedValue(new Error("OOM during render"));

    await runScriptJob("job-1");

    expect(releaseReservationFn).toHaveBeenCalledWith("res-1", expect.any(String));
    expect(captureReservationFn).not.toHaveBeenCalled();
  });

  it("marks project and job as failed when an error occurs", async () => {
    generateScriptFn.mockRejectedValue(new Error("provider error"));

    await runScriptJob("job-1");

    expect(projectUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
    expect(jobUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
  });

  it("falls back to refundCredits() for legacy jobs with no reservation (demo/pre-reservation)", async () => {
    reservationFindUnique.mockResolvedValue(null); // no reservation

    generateScriptFn.mockRejectedValue(new Error("LLM timeout"));
    await runScriptJob("job-1");

    expect(refundCreditsFn).toHaveBeenCalledWith("user-1", 10);
    expect(releaseReservationFn).not.toHaveBeenCalled();
  });

  it("creates a JobCostRecord with AI provider, TTS characters, and render seconds on success", async () => {
    await runScriptJob("job-1");

    expect(costRecordUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        projectId: "proj-1",
        aiProvider: "openai",
        aiModel: "gpt-4o-mini",
        aiInputTokens: 50,
        aiOutputTokens: 100,
        ttsCharacters: 11,
        ttsSeconds: 30,
        creditsCharged: 10,
      })
    );
  });

  it("writes a cost record with creditsRefunded on failure (not charged)", async () => {
    generateScriptFn.mockRejectedValue(new Error("LLM error"));

    await runScriptJob("job-1");

    // The cost record should record the refund, not the charge
    expect(costRecordUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ creditsRefunded: 10 })
    );
    // The success cost record (with creditsCharged) should NOT have been written
    const calls = costRecordUpsert.mock.calls;
    expect(calls.some((c) => (c[0] as Record<string, unknown>).creditsCharged !== undefined && !(c[0] as Record<string, unknown>).creditsRefunded)).toBe(false);
  });

  it("releasing a reservation is exact-once: releaseReservation is called exactly once, not twice", async () => {
    generateScriptFn.mockRejectedValue(new Error("fail"));

    await runScriptJob("job-1");

    // releaseReservation itself is idempotent (exact-once), but the runner should
    // only call it once per failure — not once per retry of a crashed runner.
    expect(releaseReservationFn).toHaveBeenCalledTimes(1);
  });
});
