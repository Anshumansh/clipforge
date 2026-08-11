import { describe, it, expect, vi, beforeEach } from "vitest";

const jobFindUnique = vi.fn();
const jobUpdate = vi.fn();
const projectUpdate = vi.fn();
const clipCreate = vi.fn();
const clipUpdate = vi.fn();
const clipCount = vi.fn();
const reservationFindUnique = vi.fn();
const costRecordUpsert = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    job: {
      findUniqueOrThrow: (...a: unknown[]) => jobFindUnique(...a),
      update: (...a: unknown[]) => jobUpdate(...a),
    },
    project: { update: (...a: unknown[]) => projectUpdate(...a) },
    clip: {
      create: (...a: unknown[]) => clipCreate(...a),
      update: (...a: unknown[]) => clipUpdate(...a),
      count: (...a: unknown[]) => clipCount(...a),
    },
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

const transcribeFn = vi.fn();
const planHighlightsFn = vi.fn();
vi.mock("@/lib/providers/transcription", () => ({ transcribeVideo: (...a: unknown[]) => transcribeFn(...a) }));
vi.mock("@/lib/providers/highlights", () => ({ planHighlightsFromTranscript: (...a: unknown[]) => planHighlightsFn(...a) }));
vi.mock("@/lib/providers/llm", () => ({ chatJSON: vi.fn().mockResolvedValue({ titles: ["Highlight 1"] }) }));
vi.mock("@/lib/providers/subject-tracking", () => ({
  analyzeSubjectPan: vi.fn().mockResolvedValue(null),
  prepareLocalSource: vi.fn().mockResolvedValue({ localPath: null, cleanup: async () => {} }),
}));

const renderClipFn = vi.fn();
vi.mock("@/lib/remotion-render", () => ({ renderRepurposeClip: (...a: unknown[]) => renderClipFn(...a) }));

vi.mock("@/lib/streaks", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/brand-server", () => ({ getBrandForRender: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/workspace", () => ({ resolveProjectCreditOwnerId: vi.fn().mockResolvedValue("user-1") }));
vi.mock("@/lib/jobs/cost-tracker", () => ({ upsertCostRecord: (...a: unknown[]) => costRecordUpsert(...a) }));

const { runRepurposeJob } = await import("@/lib/jobs/repurpose-runner");

function makeJob() {
  return {
    id: "job-1",
    project: {
      id: "proj-1",
      userId: "user-1",
      workspaceId: null,
      input: JSON.stringify({ durationSec: 60, sourcePath: "s3://bucket/source.mp4", topic: "marketing tips" }),
      title: "Test repurpose",
      user: { id: "user-1" },
    },
  };
}

const fakeClip = { id: "clip-1", startSec: 0, endSec: 15, title: "Highlight 1", score: 80 };

describe("runRepurposeJob — repurpose runner (TEST-001 + REL-001 + COST-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobFindUnique.mockResolvedValue(makeJob());
    jobUpdate.mockResolvedValue({});
    projectUpdate.mockResolvedValue({});
    clipCreate.mockResolvedValue(fakeClip);
    clipUpdate.mockResolvedValue({});
    clipCount.mockResolvedValue(1);
    transcribeFn.mockResolvedValue({ text: "hello world", words: [] });
    planHighlightsFn.mockResolvedValue([{ startSec: 0, endSec: 15, title: "Highlight 1", score: 80 }]);
    renderClipFn.mockResolvedValue("https://cdn.example.com/clip-1.mp4");
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });
    captureReservationFn.mockResolvedValue(undefined);
    releaseReservationFn.mockResolvedValue(undefined);
    refundCreditsFn.mockResolvedValue(undefined);
    costRecordUpsert.mockResolvedValue(undefined);
  });

  it("captures reservation on full success", async () => {
    await runRepurposeJob("job-1");

    expect(captureReservationFn).toHaveBeenCalledWith("res-1");
    expect(releaseReservationFn).not.toHaveBeenCalled();
    expect(refundCreditsFn).not.toHaveBeenCalled();
  });

  it("releases reservation when transcription throws", async () => {
    transcribeFn.mockRejectedValue(new Error("whisper unavailable"));

    await runRepurposeJob("job-1");

    expect(releaseReservationFn).toHaveBeenCalledWith("res-1", expect.any(String));
    expect(captureReservationFn).not.toHaveBeenCalled();
  });

  it("releases reservation when ALL clips fail to render", async () => {
    renderClipFn.mockRejectedValue(new Error("render fail"));
    clipCount.mockResolvedValue(0); // no ready clips

    await runRepurposeJob("job-1");

    expect(releaseReservationFn).toHaveBeenCalledWith("res-1", expect.any(String));
  });

  it("captures reservation even when only SOME clips fail (partial success)", async () => {
    // First clip fails, second succeeds — job is still marked done
    let callCount = 0;
    renderClipFn.mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error("clip 1 failed");
      return Promise.resolve("https://cdn.example.com/clip-2.mp4");
    });
    // planHighlights returns 2 clips
    planHighlightsFn.mockResolvedValue([
      { startSec: 0, endSec: 15, title: "Clip 1", score: 80 },
      { startSec: 20, endSec: 35, title: "Clip 2", score: 70 },
    ]);
    clipCreate.mockImplementation((args: { data: { title: string } }) => ({
      id: `clip-${args.data.title.replace(" ", "-")}`,
      ...args.data,
    }));
    clipCount.mockResolvedValue(1); // one ready clip

    await runRepurposeJob("job-1");

    expect(captureReservationFn).toHaveBeenCalled();
    expect(releaseReservationFn).not.toHaveBeenCalled();
  });

  it("records transcriptionSeconds in the cost record", async () => {
    await runRepurposeJob("job-1");

    expect(costRecordUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        transcriptionSeconds: 60, // from input.durationSec
        creditsCharged: 10,
      })
    );
  });

  it("records creditsRefunded in cost record on failure", async () => {
    transcribeFn.mockRejectedValue(new Error("fail"));

    await runRepurposeJob("job-1");

    expect(costRecordUpsert).toHaveBeenCalledWith(expect.objectContaining({ creditsRefunded: 10 }));
  });
});
