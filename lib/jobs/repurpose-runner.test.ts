import { describe, it, expect, vi, beforeEach } from "vitest";

const jobFindUnique = vi.fn();
const jobUpdate = vi.fn();
const projectUpdate = vi.fn();
const clipCreate = vi.fn();
const clipUpdate = vi.fn();
const clipCount = vi.fn();
const reservationFindUnique = vi.fn();
const costRecordUpsert = vi.fn();

type MockDb = {
  job: {
    findUniqueOrThrow: (...a: unknown[]) => unknown;
    update: (...a: unknown[]) => unknown;
  };
  project: { update: (...a: unknown[]) => unknown };
  clip: {
    create: (...a: unknown[]) => unknown;
    update: (...a: unknown[]) => unknown;
    count: (...a: unknown[]) => unknown;
  };
  creditReservation: { findUnique: (...a: unknown[]) => unknown };
  $transaction: (fn: (tx: MockDb) => Promise<unknown>) => Promise<unknown>;
};

const mockDb: MockDb = {
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
  // The success path wraps project/job/capture writes in one transaction
  // (Phase 3 hardening) -- the shim just runs the callback against this
  // same mock object.
  $transaction: async (fn) => fn(mockDb),
};

vi.mock("@/lib/db", () => ({ db: mockDb }));

const captureReservationInTxFn = vi.fn();
const releaseReservationInTxFn = vi.fn();
vi.mock("@/lib/pricing/ledger", () => ({
  captureReservationInTx: (...a: unknown[]) => captureReservationInTxFn(...a),
  releaseReservationInTx: (...a: unknown[]) => releaseReservationInTxFn(...a),
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
    captureReservationInTxFn.mockResolvedValue(undefined);
    releaseReservationInTxFn.mockResolvedValue(undefined);
    refundCreditsFn.mockResolvedValue(undefined);
    costRecordUpsert.mockResolvedValue(undefined);
  });

  it("captures reservation on full success", async () => {
    await runRepurposeJob("job-1");

    expect(captureReservationInTxFn).toHaveBeenCalledWith(expect.anything(), "res-1");
    expect(releaseReservationInTxFn).not.toHaveBeenCalled();
    expect(refundCreditsFn).not.toHaveBeenCalled();
  });

  it("captures the reservation in the SAME transaction as the project/job success writes", async () => {
    const callOrder: string[] = [];
    projectUpdate.mockImplementation(async (args: { data?: { status?: string } }) => {
      if (args?.data?.status === "ready") callOrder.push("project-ready");
    });
    jobUpdate.mockImplementation(async (args: { data?: { status?: string } }) => {
      if (args?.data?.status === "done") callOrder.push("job-done");
    });
    captureReservationInTxFn.mockImplementation(async () => {
      callOrder.push("capture");
    });

    await runRepurposeJob("job-1");

    expect(callOrder).toEqual(["project-ready", "job-done", "capture"]);
  });

  it("releases reservation when transcription throws", async () => {
    transcribeFn.mockRejectedValue(new Error("whisper unavailable"));

    await runRepurposeJob("job-1");

    expect(releaseReservationInTxFn).toHaveBeenCalledWith(expect.anything(), "res-1", expect.any(String));
    expect(captureReservationInTxFn).not.toHaveBeenCalled();
  });

  it("releases reservation when ALL clips fail to render", async () => {
    renderClipFn.mockRejectedValue(new Error("render fail"));
    clipCount.mockResolvedValue(0); // no ready clips

    await runRepurposeJob("job-1");

    expect(releaseReservationInTxFn).toHaveBeenCalledWith(expect.anything(), "res-1", expect.any(String));
  });

  it("marks project failed, job failed, and releases the reservation in the SAME transaction, in order", async () => {
    transcribeFn.mockRejectedValue(new Error("whisper unavailable"));
    const callOrder: string[] = [];
    projectUpdate.mockImplementation(async (args: { data?: { status?: string } }) => {
      if (args?.data?.status === "failed") callOrder.push("project-failed");
    });
    jobUpdate.mockImplementation(async (args: { data?: { status?: string } }) => {
      if (args?.data?.status === "failed") callOrder.push("job-failed");
    });
    releaseReservationInTxFn.mockImplementation(async () => {
      callOrder.push("release");
    });

    await runRepurposeJob("job-1");

    expect(callOrder).toEqual(["project-failed", "job-failed", "release"]);
  });

  it("a DB failure during atomic failure finalization leaves the job untouched and is logged", async () => {
    transcribeFn.mockRejectedValue(new Error("whisper unavailable"));
    // Target specifically the failure transaction's status="failed" write
    // (not the earlier status="processing" update, which also calls
    // project.update).
    projectUpdate.mockImplementation(async (args: { data?: { status?: string } }) => {
      if (args?.data?.status === "failed") throw new Error("DB connection lost mid-transaction");
      return {};
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runRepurposeJob("job-1")).resolves.toBeUndefined();
    expect(releaseReservationInTxFn).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("remains recoverable as processing/reserved"),
      expect.anything()
    );

    errorSpy.mockRestore();
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

    expect(captureReservationInTxFn).toHaveBeenCalled();
    expect(releaseReservationInTxFn).not.toHaveBeenCalled();
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
