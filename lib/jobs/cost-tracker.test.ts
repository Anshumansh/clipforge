import { describe, it, expect, vi, beforeEach } from "vitest";

const jobCostRecordUpsert = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { jobCostRecord: { upsert: (...a: unknown[]) => jobCostRecordUpsert(...a) } },
}));

const { upsertCostRecord, upsertCostRecordInTx } = await import("@/lib/jobs/cost-tracker");

// JobCostRecord.jobId carries a DB-level @unique constraint (prisma/schema.prisma).
// upsert({ where: { jobId } }) compiles to a single atomic INSERT ... ON CONFLICT
// (jobId) DO UPDATE in Postgres -- there is no window between a SELECT and an
// INSERT for two concurrent writers to race through, and no way for two rows to
// ever exist for the same jobId. These tests exercise the idempotency contract
// at the call-shape level (every write targets the same unique key, multi-stage
// partial writes accumulate onto one row, failures don't throw); a real two-
// connection race against Postgres is exercised in the Phase C integration
// tests, since a mocked Prisma client can't prove what only the real ON
// CONFLICT clause guarantees.

describe("cost-tracker idempotency (Phase B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobCostRecordUpsert.mockResolvedValue({});
  });

  it("every upsert call is keyed on the unique jobId, never on id/projectId/anything else", async () => {
    await upsertCostRecord({ jobId: "job-1", projectId: "proj-1", userId: "user-1", aiProvider: "openai" });

    expect(jobCostRecordUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobId: "job-1" } })
    );
  });

  it("multi-stage writes (LLM step, then TTS step, then render step) all target the same jobId key and only send the fields that stage measured", async () => {
    await upsertCostRecord({ jobId: "job-1", projectId: "proj-1", userId: "user-1", aiProvider: "groq", aiInputTokens: 30 });
    await upsertCostRecord({ jobId: "job-1", projectId: "proj-1", userId: "user-1", ttsCharacters: 500 });
    await upsertCostRecord({ jobId: "job-1", projectId: "proj-1", userId: "user-1", renderSeconds: 12.5 });

    expect(jobCostRecordUpsert).toHaveBeenCalledTimes(3);
    for (const call of jobCostRecordUpsert.mock.calls) {
      expect((call[0] as { where: { jobId: string } }).where).toEqual({ jobId: "job-1" });
    }
    // The TTS-stage call's update payload must not clobber aiProvider/aiInputTokens
    // with undefined -- each call only includes the fields it was given.
    const ttsCall = jobCostRecordUpsert.mock.calls[1][0] as { update: Record<string, unknown> };
    expect(ttsCall.update).toEqual({ ttsCharacters: 500 });
    expect(ttsCall.update).not.toHaveProperty("aiProvider");
  });

  it("a crashed-and-retried handler re-running upsertCostRecord for the same jobId still targets one row, not a second insert", async () => {
    // Simulates: worker records cost, then crashes before the job finalizes;
    // a fresh attempt (new attemptToken, same jobId) re-runs the same step
    // and calls upsertCostRecord again with the same jobId.
    await upsertCostRecord({ jobId: "job-1", projectId: "proj-1", userId: "user-1", aiProvider: "openai", aiInputTokens: 10 });
    await upsertCostRecord({ jobId: "job-1", projectId: "proj-1", userId: "user-1", aiProvider: "openai", aiInputTokens: 10 });

    expect(jobCostRecordUpsert).toHaveBeenCalledTimes(2);
    const [firstWhere, secondWhere] = jobCostRecordUpsert.mock.calls.map(
      (c) => (c[0] as { where: { jobId: string } }).where
    );
    expect(firstWhere).toEqual(secondWhere);
    expect(firstWhere).toEqual({ jobId: "job-1" });
  });

  it("upsertCostRecordInTx returns true on success and routes through the transaction client, not the top-level db", async () => {
    const txUpsert = vi.fn().mockResolvedValue({});
    const tx = { jobCostRecord: { upsert: txUpsert } };

    const result = await upsertCostRecordInTx(tx, { jobId: "job-1", projectId: "proj-1", userId: "user-1", creditsCharged: 10 });

    expect(result).toBe(true);
    expect(txUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "job-1" } }));
    expect(jobCostRecordUpsert).not.toHaveBeenCalled(); // never fell back to the top-level db client
  });

  it("upsertCostRecordInTx swallows a DB error and returns false instead of throwing -- a cost-record failure must never abort the job's completion transaction", async () => {
    const txUpsert = vi.fn().mockRejectedValue(new Error("connection reset"));
    const tx = { jobCostRecord: { upsert: txUpsert } };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await upsertCostRecordInTx(tx, { jobId: "job-1", projectId: "proj-1", userId: "user-1" });

    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to record cost for job job-1"),
      expect.anything()
    );

    errorSpy.mockRestore();
  });

  it("default credit fields are zero, not undefined, on first creation -- a partial write before any charge/refund must not leave NULL credit columns", async () => {
    await upsertCostRecord({ jobId: "job-1", projectId: "proj-1", userId: "user-1", aiProvider: "openai" });

    const call = jobCostRecordUpsert.mock.calls[0][0] as { create: Record<string, unknown> };
    expect(call.create.creditsCharged).toBe(0);
    expect(call.create.creditsRefunded).toBe(0);
  });
});
