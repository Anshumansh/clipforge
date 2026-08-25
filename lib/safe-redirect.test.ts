import { describe, expect, it } from "vitest";
import { safeInternalPath } from "./safe-redirect";

describe("safeInternalPath", () => {
  it("keeps valid in-app destinations", () => {
    expect(safeInternalPath("/dashboard/projects/abc?tab=video#preview")).toBe(
      "/dashboard/projects/abc?tab=video#preview"
    );
  });

  it.each([
    "https://evil.example",
    "//evil.example/path",
    "javascript:alert(1)",
    "dashboard",
  ])("rejects unsafe destination %s", (value) => {
    expect(safeInternalPath(value)).toBe("/dashboard");
  });

  it("uses the requested fallback for missing values", () => {
    expect(safeInternalPath(null, "/")).toBe("/");
  });
});
