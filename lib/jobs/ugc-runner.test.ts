import { describe, it, expect, vi, beforeEach } from "vitest";

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

const generateAdScriptFn = vi.fn();
vi.mock("@/lib/providers/script", () => ({
  generateAdScript: (...a: unknown[]) => generateAdScriptFn(...a),
}));

const synthesizeVoiceoverFn = vi.fn();
vi.mock("@/lib/providers/tts", () => ({
  synthesizeVoiceover: (...a: unknown[]) => synthesizeVoiceoverFn(...a),
}));

const pickBrollFn = vi.fn();
vi.mock("@/lib/providers/broll", () => ({ pickBrollScenes: (...a: unknown[]) => pickBrollFn(...a) }));

const renderScriptVideoFn = vi.fn();
vi.mock("@/lib/remotion-render", () => ({ renderScriptVideo: (...a: unknown[]) => renderScriptVideoFn(...a) }));

vi.mock("@/lib/streaks", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/brand-server", () => ({ getBrandForRender: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/workspace", () => ({ resolveProjectCreditOwnerId: vi.fn().mockResolvedValue("user-1") }));
vi.mock("@/lib/jobs/cost-tracker", () => ({ upsertCostRecord: (...a: unknown[]) => costRecordUpsert(...a) }));

const { runUgcJob } = await import("@/lib/jobs/ugc-runner");

function makeJob() {
  return {
    id: "job-1",
    project: {
      id: "proj-1",
      userId: "user-1",
      workspaceId: null,
      input: JSON.stringify({ productName: "TestProduct", sellingPoints: "fast, cheap", ctaText: "Buy now" }),
      title: "TestProduct — UGC ad",
      user: { id: "user-1" },
    },
  };
}

describe("runUgcJob — UGC runner (TEST-001 + REL-001 + COST-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobFindUnique.mockResolvedValue(makeJob());
    jobUpdate.mockResolvedValue({});
    projectUpdate.mockResolvedValue({});
    generateAdScriptFn.mockResolvedValue({ title: "TestProduct Ad", script: "Buy TestProduct!", sceneKeywords: ["product"], provider: "groq", inputTokens: 30, outputTokens: 80 });
    pickBrollFn.mockResolvedValue([]);
    synthesizeVoiceoverFn.mockResolvedValue({ audioUrl: "https://cdn.example.com/audio.mp3", durationSec: 20, words: [], mocked: false, provider: "openai", characterCount: 17 });
    renderScriptVideoFn.mockResolvedValue("https://cdn.example.com/final.mp4");
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });
    captureReservationFn.mockResolvedValue(undefined);
    releaseReservationFn.mockResolvedValue(undefined);
    refundCreditsFn.mockResolvedValue(undefined);
    costRecordUpsert.mockResolvedValue(undefined);
  });

  it("captures reservation on success — credits settled, not refunded", async () => {
    await runUgcJob("job-1");

    expect(captureReservationFn).toHaveBeenCalledWith("res-1");
    expect(releaseReservationFn).not.toHaveBeenCalled();
    expect(refundCreditsFn).not.toHaveBeenCalled();
  });

  it("releases reservation when script generation fails", async () => {
    generateAdScriptFn.mockRejectedValue(new Error("script fail"));

    await runUgcJob("job-1");

    expect(releaseReservationFn).toHaveBeenCalledWith("res-1", expect.any(String));
    expect(captureReservationFn).not.toHaveBeenCalled();
  });

  it("releases reservation when render fails", async () => {
    renderScriptVideoFn.mockRejectedValue(new Error("render OOM"));

    await runUgcJob("job-1");

    expect(releaseReservationFn).toHaveBeenCalledWith("res-1", expect.any(String));
  });

  it("creates a JobCostRecord with cost metrics on success", async () => {
    await runUgcJob("job-1");

    expect(costRecordUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        aiProvider: "groq",
        aiModel: "llama-3.3-70b-versatile",
        aiInputTokens: 30,
        aiOutputTokens: 80,
        ttsCharacters: 17,
        creditsCharged: 10,
      })
    );
  });

  it("records creditsRefunded in cost record on failure", async () => {
    generateAdScriptFn.mockRejectedValue(new Error("fail"));

    await runUgcJob("job-1");

    expect(costRecordUpsert).toHaveBeenCalledWith(expect.objectContaining({ creditsRefunded: 10 }));
  });
});
