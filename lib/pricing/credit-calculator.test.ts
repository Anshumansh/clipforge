import { describe, it, expect } from "vitest";
import {
  creditsForStandardVideo,
  UnpricedDurationError,
  UGC_AD_CREDITS,
  creditsForRepurposeSource,
  creditsForRepurposeClips,
  THUMBNAIL_CREDITS,
  calculateStandardVideoCost,
  calculateUgcAdCost,
  estimateRepurposeCost,
  SURCHARGE_PREMIUM_TTS,
  SURCHARGE_ADDITIONAL_ASPECT_RATIO,
  SURCHARGE_4K_EXPORT,
  SURCHARGE_VOICE_CLONING_MIN,
} from "./credit-calculator";

describe("creditsForStandardVideo", () => {
  it("prices every band exactly as specified in the brief", () => {
    expect(creditsForStandardVideo(30)).toBe(10);
    expect(creditsForStandardVideo(45)).toBe(10);
    expect(creditsForStandardVideo(46)).toBe(15);
    expect(creditsForStandardVideo(60)).toBe(15);
    expect(creditsForStandardVideo(61)).toBe(25);
    expect(creditsForStandardVideo(90)).toBe(25);
  });

  it("floors sub-30s durations at the cheapest defined band rather than inventing a lower price", () => {
    expect(creditsForStandardVideo(5)).toBe(10);
  });

  it("throws UnpricedDurationError beyond 90s instead of guessing at a price", () => {
    expect(() => creditsForStandardVideo(91)).toThrow(UnpricedDurationError);
    expect(() => creditsForStandardVideo(600)).toThrow(UnpricedDurationError);
  });

  it("rejects non-positive durations", () => {
    expect(() => creditsForStandardVideo(0)).toThrow(RangeError);
    expect(() => creditsForStandardVideo(-5)).toThrow(RangeError);
  });
});

describe("calculateStandardVideoCost", () => {
  it("returns just the base cost with no add-ons", () => {
    const result = calculateStandardVideoCost({ durationSec: 40 });
    expect(result).toEqual({ baseCredits: 10, surcharges: [], totalCredits: 10 });
  });

  it("stacks every surcharge correctly", () => {
    const result = calculateStandardVideoCost({
      durationSec: 55, // 15 base
      premiumTts: true, // +3
      additionalAspectRatios: 2, // +3*2 = 6
      export4k: true, // +15
      voiceCloning: true, // +30
    });
    expect(result.baseCredits).toBe(15);
    expect(result.totalCredits).toBe(15 + SURCHARGE_PREMIUM_TTS + SURCHARGE_ADDITIONAL_ASPECT_RATIO * 2 + SURCHARGE_4K_EXPORT + SURCHARGE_VOICE_CLONING_MIN);
    expect(result.totalCredits).toBe(69);
  });

  it("matches the brief's worked example duration exactly (30-45s -> 10 credits)", () => {
    expect(calculateStandardVideoCost({ durationSec: 35 }).totalCredits).toBe(10);
  });
});

describe("calculateUgcAdCost", () => {
  it("is a flat cost independent of duration", () => {
    expect(calculateUgcAdCost().totalCredits).toBe(UGC_AD_CREDITS);
  });

  it("still stacks surcharges on top of the flat UGC base", () => {
    const result = calculateUgcAdCost({ export4k: true });
    expect(result.totalCredits).toBe(UGC_AD_CREDITS + SURCHARGE_4K_EXPORT);
  });
});

describe("repurpose pricing", () => {
  it("charges 2 credits per source minute, rounding partial minutes up", () => {
    expect(creditsForRepurposeSource(30)).toBe(60);
    expect(creditsForRepurposeSource(1)).toBe(2);
    expect(creditsForRepurposeSource(0.5)).toBe(1); // ceil(1) = 1
  });

  it("charges 10 credits per completed clip", () => {
    expect(creditsForRepurposeClips(5)).toBe(50);
    expect(creditsForRepurposeClips(0)).toBe(0);
  });

  it("matches the brief's worked example exactly: 30min upload, 5 clips = 110 credits", () => {
    const source = creditsForRepurposeSource(30);
    const clips = creditsForRepurposeClips(5);
    expect(source).toBe(60);
    expect(clips).toBe(50);
    expect(source + clips).toBe(110);
  });

  it("estimateRepurposeCost matches the same worked example", () => {
    const estimate = estimateRepurposeCost(30, 5);
    expect(estimate.totalCredits).toBe(110);
  });
});

describe("thumbnails", () => {
  it("cost exactly 1 credit", () => {
    expect(THUMBNAIL_CREDITS).toBe(1);
  });
});
