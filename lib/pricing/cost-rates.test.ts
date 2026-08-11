import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getCostRates } from "./cost-rates";

const RATE_ENV_VARS = [
  "COST_RATE_AI_INPUT_PER_1K_TOKENS_USD",
  "COST_RATE_AI_OUTPUT_PER_1K_TOKENS_USD",
  "COST_RATE_TRANSCRIPTION_PER_MINUTE_USD",
  "COST_RATE_TTS_PER_CHARACTER_USD",
  "COST_RATE_VOICE_CLONE_COMPUTE_PER_SECOND_USD",
  "COST_RATE_RENDER_COMPUTE_PER_SECOND_USD",
  "COST_RATE_STORAGE_PER_GB_MONTH_USD",
  "COST_RATE_BANDWIDTH_PER_GB_USD",
  "COST_RATE_STRIPE_PERCENT_FEE",
  "COST_RATE_STRIPE_FLAT_FEE_USD",
];

beforeEach(() => {
  for (const key of RATE_ENV_VARS) delete process.env[key];
});
afterEach(() => {
  for (const key of RATE_ENV_VARS) delete process.env[key];
});

describe("getCostRates", () => {
  it("defaults every rate to null rather than an invented number", () => {
    const rates = getCostRates();
    for (const value of Object.values(rates)) {
      expect(value).toBeNull();
    }
  });

  it("reads a configured rate as a number", () => {
    process.env.COST_RATE_AI_INPUT_PER_1K_TOKENS_USD = "0.0025";
    expect(getCostRates().aiInputPer1kTokensUsd).toBe(0.0025);
  });

  it("treats an unparseable value as still-unset (null), not zero or NaN", () => {
    process.env.COST_RATE_TTS_PER_CHARACTER_USD = "not-a-number";
    expect(getCostRates().ttsPerCharacterUsd).toBeNull();
  });
});
