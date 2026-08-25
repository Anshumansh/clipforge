import { describe, expect, it } from "vitest";
import {
  JOB_PRIORITY_DEMO,
  JOB_PRIORITY_PAID_STANDARD,
  JOB_PRIORITY_PAID_URGENT,
  JOB_PRIORITY_VERIFIED_FREE,
  getGenerationPriority,
} from "./priorities";

describe("getGenerationPriority", () => {
  it("orders Business, paid, verified Free and anonymous demo work", () => {
    expect(getGenerationPriority("business")).toBe(JOB_PRIORITY_PAID_URGENT);
    expect(getGenerationPriority("creator")).toBe(JOB_PRIORITY_PAID_STANDARD);
    expect(getGenerationPriority("hobby")).toBe(JOB_PRIORITY_PAID_STANDARD);
    expect(getGenerationPriority("free")).toBe(JOB_PRIORITY_VERIFIED_FREE);
    expect(JOB_PRIORITY_VERIFIED_FREE).toBeGreaterThan(JOB_PRIORITY_DEMO);
  });

  it("uses neutral priority for an unknown historical plan", () => {
    expect(getGenerationPriority("unknown")).toBe(0);
  });
});
