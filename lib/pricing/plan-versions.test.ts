import { describe, it, expect, vi, beforeEach } from "vitest";

const planVersionUpsert = vi.fn();
const planVersionFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    planVersion: {
      upsert: (...a: unknown[]) => planVersionUpsert(...a),
      findUnique: (...a: unknown[]) => planVersionFindUnique(...a),
    },
  },
}));

const { seedPlanVersions, resolvePlanConfig } = await import("./plan-versions");
const { PLAN_CONFIGS, CURRENT_PLAN_VERSION_LABEL } = await import("./plan-config");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("seedPlanVersions", () => {
  it("upserts all five plans keyed on [planId, versionLabel]", async () => {
    planVersionUpsert.mockResolvedValue({});

    await seedPlanVersions();

    expect(planVersionUpsert).toHaveBeenCalledTimes(5);
    expect(planVersionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { planId_versionLabel: { planId: "business", versionLabel: CURRENT_PLAN_VERSION_LABEL } },
      })
    );
  });
});

describe("resolvePlanConfig", () => {
  it("returns null for a null planVersionId (legacy account, no versioned plan yet)", async () => {
    expect(await resolvePlanConfig(null)).toBeNull();
    expect(planVersionFindUnique).not.toHaveBeenCalled();
  });

  it("returns the parsed config for a known planVersionId", async () => {
    planVersionFindUnique.mockResolvedValue({ configJson: JSON.stringify(PLAN_CONFIGS.creator) });

    const result = await resolvePlanConfig("version-1");

    expect(result?.planId).toBe("creator");
    expect(result?.monthlyCredits).toBe(600);
  });

  it("returns null when the referenced version doesn't exist", async () => {
    planVersionFindUnique.mockResolvedValue(null);

    expect(await resolvePlanConfig("missing-version")).toBeNull();
  });
});
