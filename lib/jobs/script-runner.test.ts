import { describe, it, expect, vi, beforeEach } from "vitest";

// ------------------------------------------------------------------
// Mocks
// ------------------------------------------------------------------

const jobFindUnique = vi.fn();
const jobUpdate = vi.fn();
const jobUpdateMany = vi.fn();
const projectUpdate = vi.fn();
const reservationFindUnique = vi.fn();
const costRecordUpsert = vi.fn();

type MockDb = {
  job: {
    findUniqueOrThrow: (...a: unknown[]) => unknown;
    update: (...a: unknown[]) => unknown;
    updateMany: (...a: unknown[]) => unknown;
  };
  project: { update: (...a: unknown[]) => unknown };
  creditReservation: { findUnique: (...a: unknown[]) => unknown };
  $transaction: (fn: (tx: MockDb) => Promise<unknown>) => Promise<unknown>;
};

const mockDb: MockDb = {
  job: {
    findUniqueOrThrow: (...a: unknown[]) => jobFindUnique(...a),
    update: (...a: unknown[]) => jobUpdate(...a),
    updateMany: (...a: unknown[]) => jobUpdateMany(...a),
  },
  project: { update: (...a: unknown[]) => projectUpdate(...a) },
  creditReservation: { findUnique: (...a: unknown[]) => reservationFindUnique(...a) },
  // The success path now wraps project/job/capture writes in one
  // transaction (Phase 3 hardening) -- the shim just runs the callback
  // against this same mock object, so tx.project.update etc. are backed
  // by the exact same spies as a direct db.project.update call.
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

const costRecordUpsertInTx = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/jobs/cost-tracker", () => ({
  upsertCostRecord: (...a: unknown[]) => costRecordUpsert(...a),
  upsertCostRecordInTx: (...a: unknown[]) => costRecordUpsertInTx(...a),
}));

const { runScriptJob } = await import("@/lib/jobs/script-runner");

// ------------------------------------------------------------------
// Test fixtures
// ------------------------------------------------------------------

function makeJob(overrides = {}) {
  return {
    id: "job-1",
    workerId: "worker-1",
    attemptToken: "token-abc123",
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
    jobUpdateMany.mockResolvedValue({ count: 1 });
    projectUpdate.mockResolvedValue({});
    generateScriptFn.mockResolvedValue(mockScript);
    pickBrollFn.mockResolvedValue([]);
    synthesizeVoiceoverFn.mockResolvedValue(mockVoiceover);
    renderScriptVideoFn.mockResolvedValue("https://b2.example.com/final.mp4");
    reservationFindUnique.mockResolvedValue({ id: "res-1", status: "reserved" });
    captureReservationInTxFn.mockResolvedValue(undefined);
    releaseReservationInTxFn.mockResolvedValue(undefined);
    refundCreditsFn.mockResolvedValue(undefined);
    costRecordUpsert.mockResolvedValue(undefined);
  });

  it("captures the reservation on successful completion (credits settled, not refunded)", async () => {
    await runScriptJob("job-1", "worker-1", "token-abc123");

    // Second arg is the reservation id; first is the transaction client
    // (see the $transaction shim above) -- captureReservationInTx now runs
    // inside the same transaction as the project/job "done" writes.
    expect(captureReservationInTxFn).toHaveBeenCalledWith(expect.anything(), "res-1");
    expect(releaseReservationInTxFn).not.toHaveBeenCalled();
    expect(refundCreditsFn).not.toHaveBeenCalled();
  });

  it("captures the reservation in the SAME transaction as the project/job success writes -- no crash window between them", async () => {
    const callOrder: string[] = [];
    jobUpdateMany.mockImplementation(async (args: { data?: { status?: string } }) => {
      if (args?.data?.status === "done") callOrder.push("job-done");
      return { count: 1 };
    });
    projectUpdate.mockImplementation(async (args: { data?: { status?: string } }) => {
      if (args?.data?.status === "ready") callOrder.push("project-ready");
    });
    captureReservationInTxFn.mockImplementation(async () => {
      callOrder.push("capture");
    });

    await runScriptJob("job-1", "worker-1", "token-abc123");

    // All three happened, in order, and (since they share the $transaction
    // shim's single synchronous pass over the same mock client) as part of
    // one atomic unit rather than three independent statements a crash
    // could land between. Note: job-done now happens via updateMany BEFORE project-ready.
    expect(callOrder).toEqual(["job-done", "project-ready", "capture"]);
  });

  it("marks project and job as done on success", async () => {
    await runScriptJob("job-1", "worker-1", "token-abc123");

    // Job update via updateMany (with lease fencing)
    expect(jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job-1", status: "processing", workerId: "worker-1", attemptToken: "token-abc123" },
      data: expect.objectContaining({ status: "done" })
    }));
    // Project update via regular update
    expect(projectUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ready" }) }));
  });

  it("releases the reservation (not refundCredits) when LLM fails — idempotent refund", async () => {
    generateScriptFn.mockRejectedValue(new Error("LLM timeout"));

    await runScriptJob("job-1", "worker-1", "token-abc123");

    expect(releaseReservationInTxFn).toHaveBeenCalledWith(expect.anything(), "res-1", expect.any(String));
    expect(captureReservationInTxFn).not.toHaveBeenCalled();
    expect(refundCreditsFn).not.toHaveBeenCalled();
  });

  it("releases the reservation when TTS fails", async () => {
    synthesizeVoiceoverFn.mockRejectedValue(new Error("All TTS providers failed"));

    await runScriptJob("job-1", "worker-1", "token-abc123");

    expect(releaseReservationInTxFn).toHaveBeenCalledWith(expect.anything(), "res-1", expect.any(String));
    expect(captureReservationInTxFn).not.toHaveBeenCalled();
  });

  it("releases the reservation when render fails", async () => {
    renderScriptVideoFn.mockRejectedValue(new Error("OOM during render"));

    await runScriptJob("job-1", "worker-1", "token-abc123");

    expect(releaseReservationInTxFn).toHaveBeenCalledWith(expect.anything(), "res-1", expect.any(String));
    expect(captureReservationInTxFn).not.toHaveBeenCalled();
  });

  it("marks project and job as failed when an error occurs", async () => {
    generateScriptFn.mockRejectedValue(new Error("provider error"));

    await runScriptJob("job-1", "worker-1", "token-abc123");

    // Error path now uses updateMany for job (atomic lease check)
    expect(jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job-1", status: "processing", workerId: "worker-1", attemptToken: "token-abc123" },
      data: expect.objectContaining({ status: "failed" })
    }));
    expect(projectUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
  });

  it("marks project failed, job failed, and releases the reservation in the SAME transaction, in order -- no crash window between them", async () => {
    generateScriptFn.mockRejectedValue(new Error("provider error"));
    const callOrder: string[] = [];
    // Error path now uses updateMany for job (with lease check) within transaction
    jobUpdateMany.mockImplementation(async (args: { data?: { status?: string } }) => {
      if (args?.data?.status === "failed") callOrder.push("job-failed");
      return { count: 1 };
    });
    projectUpdate.mockImplementation(async (args: { data?: { status?: string } }) => {
      if (args?.data?.status === "failed") callOrder.push("project-failed");
    });
    releaseReservationInTxFn.mockImplementation(async () => {
      callOrder.push("release");
    });

    await runScriptJob("job-1", "worker-1", "token-abc123");

    // Order: job checked and updated first (atomic lease check), then project, then release
    expect(callOrder).toEqual(["job-failed", "project-failed", "release"]);
  });

  it("a DB failure during atomic failure finalization leaves the job untouched (no partial failed-without-release state) and is logged", async () => {
    generateScriptFn.mockRejectedValue(new Error("provider error"));
    // Target specifically the failure transaction's status="failed" write
    // (not the earlier status="processing" update at the top of the try
    // block, which also calls project.update) -- it runs before
    // releaseReservationInTx in the failure transaction, so failing it
    // proves release is never reached once an earlier statement in the
    // same transaction throws.
    projectUpdate.mockImplementation(async (args: { data?: { status?: string } }) => {
      if (args?.data?.status === "failed") throw new Error("DB connection lost mid-transaction");
      return {};
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runScriptJob("job-1", "worker-1", "token-abc123")).resolves.toBeUndefined(); // the runner's own catch swallows this, doesn't crash the process
    expect(releaseReservationInTxFn).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("remains recoverable as processing/reserved"),
      expect.anything()
    );

    errorSpy.mockRestore();
  });

  it("falls back to refundCredits() for legacy jobs with no reservation (demo/pre-reservation)", async () => {
    reservationFindUnique.mockResolvedValue(null); // no reservation

    generateScriptFn.mockRejectedValue(new Error("LLM timeout"));
    await runScriptJob("job-1", "worker-1", "token-abc123");

    expect(refundCreditsFn).toHaveBeenCalledWith("user-1", 10);
    expect(releaseReservationInTxFn).not.toHaveBeenCalled();
  });

  it("creates a JobCostRecord with AI provider, TTS characters, and render seconds on success", async () => {
    await runScriptJob("job-1", "worker-1", "token-abc123");

    // Cost record is now recorded inside the success transaction via costRecordUpsertInTx
    expect(costRecordUpsertInTx).toHaveBeenCalledWith(
      expect.anything(), // tx client
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

    await runScriptJob("job-1", "worker-1", "token-abc123");

    // The cost record should record the refund via the old upsertCostRecord (still called post-transaction)
    expect(costRecordUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ creditsRefunded: 10, jobId: "job-1" })
    );
    // The success cost record (with creditsCharged) should NOT have been written
    const calls = costRecordUpsert.mock.calls;
    expect(calls.some((c) => (c[0] as Record<string, unknown>).creditsCharged !== undefined && !(c[0] as Record<string, unknown>).creditsRefunded)).toBe(false);
  });

  it("releasing a reservation is exact-once: releaseReservation is called exactly once, not twice", async () => {
    generateScriptFn.mockRejectedValue(new Error("fail"));

    await runScriptJob("job-1", "worker-1", "token-abc123");

    // releaseReservation itself is idempotent (exact-once), but the runner should
    // only call it once per failure — not once per retry of a crashed runner.
    expect(releaseReservationInTxFn).toHaveBeenCalledTimes(1);
  });

  describe("media fencing (Phase A)", () => {
    it("uploads the render to an attempt-scoped key, not a fixed final.mp4 key two attempts could collide on", async () => {
      await runScriptJob("job-1", "worker-1", "token-abc123");

      expect(renderScriptVideoFn).toHaveBeenCalledWith(
        expect.anything(),
        "jobs/job-1/attempts/token-abc123/output.mp4",
        expect.any(Function)
      );
    });

    it("checks the lease (via renewLease's updateMany) before rendering and again after upload, before finalizing", async () => {
      const leaseCheckOrder: string[] = [];
      jobUpdateMany.mockImplementation(async (args: { data?: { leaseExpiresAt?: Date; status?: string } }) => {
        if (args?.data?.leaseExpiresAt) leaseCheckOrder.push("lease-renew");
        if (args?.data?.status === "done") leaseCheckOrder.push("finalize");
        return { count: 1 };
      });

      await runScriptJob("job-1", "worker-1", "token-abc123");

      // Two renewLease calls (before render, after upload) both before the
      // finalize updateMany that actually marks the job "done".
      expect(leaseCheckOrder).toEqual(["lease-renew", "lease-renew", "finalize"]);
    });

    it("a stale worker that loses the lease AFTER upload never finalizes the job or exposes the attempt's video", async () => {
      let renewCalls = 0;
      jobUpdateMany.mockImplementation(async (args: { data?: { leaseExpiresAt?: Date; status?: string } }) => {
        if (args?.data?.leaseExpiresAt) {
          renewCalls++;
          // First checkpoint (before render) still owns the lease; second
          // checkpoint (after upload) has lost it to another worker.
          return { count: renewCalls === 1 ? 1 : 0 };
        }
        return { count: 1 };
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await runScriptJob("job-1", "worker-1", "token-abc123");

      // The render still happened (upload already in flight before the lease
      // was lost), but finalization must never run: no "done" job write, no
      // Project.videoUrl write exposing this attempt's output, no capture.
      expect(renderScriptVideoFn).toHaveBeenCalled();
      expect(jobUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "done" }) }));
      expect(projectUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ready" }) }));
      expect(captureReservationInTxFn).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("lease lost after upload"));

      errorSpy.mockRestore();
    });
  });
});
