import { describe, it, expect, vi, beforeEach } from "vitest";
import { isBenchmarkStale, SEED_BENCHMARKS, COMPETITOR_STALENESS_DAYS } from "./competitors";

const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    competitorBenchmark: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
      findMany: (...a: unknown[]) => findMany(...a),
    },
  },
}));

const { seedCompetitorBenchmarks, getActiveCompetitorBenchmarks } = await import("./competitors");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SEED_BENCHMARKS", () => {
  it("matches the brief's exact figures", () => {
    const opusStarter = SEED_BENCHMARKS.find((b) => b.competitor === "opusclip" && b.planName === "Starter");
    expect(opusStarter?.priceUsd).toBe(15);

    const revidUltra = SEED_BENCHMARKS.find((b) => b.competitor === "revid" && b.planName === "Ultra");
    expect(revidUltra?.priceUsd).toBe(199);

    const klapProPlus = SEED_BENCHMARKS.find((b) => b.competitor === "klap" && b.planName === "Pro+");
    expect(klapProPlus?.priceUsd).toBe(94);
  });

  it("never includes Vizard -- the brief says its pricing must be verified first, not guessed", () => {
    expect(SEED_BENCHMARKS.some((b) => b.competitor === "vizard")).toBe(false);
  });
});

describe("seedCompetitorBenchmarks", () => {
  it("creates a new row when none exists yet", async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue({});

    await seedCompetitorBenchmarks(new Date("2026-08-11"));

    expect(create).toHaveBeenCalledTimes(SEED_BENCHMARKS.length);
    expect(update).not.toHaveBeenCalled();
  });

  it("updates (not duplicates) an existing row for the same competitor/plan/period", async () => {
    findFirst.mockResolvedValue({ id: "existing-1" });
    update.mockResolvedValue({});

    await seedCompetitorBenchmarks(new Date("2026-08-11"));

    expect(update).toHaveBeenCalledTimes(SEED_BENCHMARKS.length);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("isBenchmarkStale", () => {
  it("is not stale within the 30-day window", () => {
    const verifiedAt = new Date("2026-08-01");
    const now = new Date("2026-08-11"); // 10 days later
    expect(isBenchmarkStale(verifiedAt, now)).toBe(false);
  });

  it("is stale past the 30-day window", () => {
    const verifiedAt = new Date("2026-07-01");
    const now = new Date("2026-08-11"); // 41 days later
    expect(isBenchmarkStale(verifiedAt, now)).toBe(true);
  });

  it("uses exactly the brief's 30-day threshold", () => {
    expect(COMPETITOR_STALENESS_DAYS).toBe(30);
  });
});

describe("getActiveCompetitorBenchmarks", () => {
  it("excludes stale benchmarks entirely rather than flagging them", async () => {
    const now = new Date("2026-08-11");
    findMany.mockResolvedValue([
      { id: "fresh", verifiedAt: new Date("2026-08-05") },
      { id: "stale", verifiedAt: new Date("2026-01-01") },
    ]);

    const result = await getActiveCompetitorBenchmarks(now);

    expect(result.map((b) => b.id)).toEqual(["fresh"]);
  });
});
