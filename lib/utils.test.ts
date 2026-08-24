import { describe, it, expect, afterEach, vi } from "vitest";
import { localDateKey } from "./utils";

// Regression coverage for a real bug in components/schedule-calendar.tsx:
// its local dateKey used to be iso.slice(0, 10), which gives the UTC
// calendar day, while the calendar grid it feeds is built from Date's
// local getters (getFullYear/getMonth). For anyone west of UTC, an
// evening-local post is already "tomorrow" in UTC -- the post's dot landed
// on the wrong grid cell, and clicking a day wouldn't show items actually
// scheduled for it. localDateKey must agree with a local-getter-built grid:
// both local.
describe("localDateKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the local calendar day, not the UTC day, for a timestamp that crosses midnight UTC", () => {
    // 2026-08-24 20:00 in UTC-7 (e.g. Los Angeles) is 2026-08-25 03:00 UTC --
    // the old iso.slice(0, 10) implementation would have returned "2026-08-25".
    vi.stubEnv("TZ", "America/Los_Angeles");
    const iso = "2026-08-25T03:00:00.000Z";
    expect(localDateKey(iso)).toBe("2026-08-24");
  });

  it("pads single-digit months and days", () => {
    vi.stubEnv("TZ", "UTC");
    expect(localDateKey("2026-01-05T12:00:00.000Z")).toBe("2026-01-05");
  });

  it("agrees with a grid cell key built the same way the calendar component builds one", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const iso = "2026-08-25T03:00:00.000Z";
    const d = new Date(iso);
    const gridKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(localDateKey(iso)).toBe(gridKey);
  });
});
