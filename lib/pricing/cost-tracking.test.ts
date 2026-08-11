import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CostRates } from "./cost-rates";

const jobCostRecordUpsert = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { jobCostRecord: { upsert: (...a: unknown[]) => jobCostRecordUpsert(...a) } },
}));

const { recordJobUsage, totalKnownCostUsd } = await import("./cost-tracking");

const NULL_RATES: CostRates = {
  aiInputPer1kTokensUsd: null,
  aiOutputPer1kTokensUsd: null,
  transcriptionPerMinuteUsd: null,
  ttsPerCharacterUsd: null,
  voiceCloneComputePerSecondUsd: null,
  renderComputePerSecondUsd: null,
  storagePerGbMonthUsd: null,
  bandwidthPerGbUsd: null,
  stripePercentFee: null,
  stripeFlatFeeUsd: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordJobUsage", () => {
  it("leaves every *CostUsd field null when no rates are configured, never guessing at 0", async () => {
    jobCostRecordUpsert.mockResolvedValue({});

    await recordJobUsage(
      { jobId: "job-1", projectId: "proj-1", userId: "user-1", aiInputTokens: 500, renderSeconds: 20 },
      NULL_RATES
    );

    const call = jobCostRecordUpsert.mock.calls[0][0];
    expect(call.create.aiCostUsd).toBeNull();
    expect(call.create.renderCostUsd).toBeNull();
  });

  it("computes cost fields once a rate is available", async () => {
    jobCostRecordUpsert.mockResolvedValue({});
    const rates: CostRates = { ...NULL_RATES, aiInputPer1kTokensUsd: 0.002, renderComputePerSecondUsd: 0.001 };

    await recordJobUsage(
      { jobId: "job-1", projectId: "proj-1", userId: "user-1", aiInputTokens: 2000, renderSeconds: 30 },
      rates
    );

    const call = jobCostRecordUpsert.mock.calls[0][0];
    expect(call.create.aiCostUsd).toBeCloseTo(0.004); // 2000/1000 * 0.002
    expect(call.create.renderCostUsd).toBeCloseTo(0.03); // 30 * 0.001
  });

  it("converts byte counts to BigInt for storage/bandwidth", async () => {
    jobCostRecordUpsert.mockResolvedValue({});

    await recordJobUsage(
      { jobId: "job-1", projectId: "proj-1", userId: "user-1", storageBytes: 12345, bandwidthBytes: 6789 },
      NULL_RATES
    );

    const call = jobCostRecordUpsert.mock.calls[0][0];
    expect(call.create.storageBytes).toBe(12345n);
    expect(call.create.bandwidthBytes).toBe(6789n);
  });

  it("upserts on jobId so repeated calls merge rather than duplicate", async () => {
    jobCostRecordUpsert.mockResolvedValue({});

    await recordJobUsage({ jobId: "job-1", projectId: "proj-1", userId: "user-1" }, NULL_RATES);

    expect(jobCostRecordUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "job-1" } }));
  });
});

describe("totalKnownCostUsd", () => {
  it("returns null when every component is unknown", () => {
    expect(
      totalKnownCostUsd({
        aiCostUsd: null,
        transcriptionCostUsd: null,
        ttsCostUsd: null,
        voiceCloneCostUsd: null,
        renderCostUsd: null,
        storageCostUsd: null,
        bandwidthCostUsd: null,
        retryCostUsd: null,
      })
    ).toBeNull();
  });

  it("sums only the known components, ignoring nulls", () => {
    expect(
      totalKnownCostUsd({
        aiCostUsd: 0.01,
        transcriptionCostUsd: null,
        ttsCostUsd: 0.02,
        voiceCloneCostUsd: null,
        renderCostUsd: 0.05,
        storageCostUsd: null,
        bandwidthCostUsd: null,
        retryCostUsd: null,
      })
    ).toBeCloseTo(0.08);
  });
});
