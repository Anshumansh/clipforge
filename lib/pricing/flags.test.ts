import { describe, it, expect, vi, beforeEach } from "vitest";

const killSwitchFindUnique = vi.fn();
const killSwitchUpsert = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    killSwitch: {
      findUnique: (...a: unknown[]) => killSwitchFindUnique(...a),
      upsert: (...a: unknown[]) => killSwitchUpsert(...a),
    },
  },
}));

const { isFeatureAllowed, setKillSwitch } = await import("./flags");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isFeatureAllowed", () => {
  it("allows a feature with no row at all (default-allowed, not default-blocked)", async () => {
    killSwitchFindUnique.mockResolvedValue(null);

    expect(await isFeatureAllowed("voice_clone")).toBe(true);
  });

  it("blocks a feature explicitly disabled", async () => {
    killSwitchFindUnique.mockImplementation(({ where }: { where: { feature: string } }) =>
      where.feature === "voice_clone" ? { feature: "voice_clone", enabled: false } : null
    );

    expect(await isFeatureAllowed("voice_clone")).toBe(false);
  });

  it("global kill switch overrides an otherwise-enabled specific feature", async () => {
    killSwitchFindUnique.mockImplementation(({ where }: { where: { feature: string } }) =>
      where.feature === "global" ? { feature: "global", enabled: false } : { feature: where.feature, enabled: true }
    );

    expect(await isFeatureAllowed("repurpose")).toBe(false);
  });
});

describe("setKillSwitch", () => {
  it("upserts the feature row with the admin who changed it", async () => {
    killSwitchUpsert.mockResolvedValue({});

    await setKillSwitch("4k_export", false, "admin-1", "cost spike");

    expect(killSwitchUpsert).toHaveBeenCalledWith({
      where: { feature: "4k_export" },
      create: { feature: "4k_export", enabled: false, updatedByUserId: "admin-1", reason: "cost spike" },
      update: { enabled: false, updatedByUserId: "admin-1", reason: "cost spike" },
    });
  });
});
