import { afterEach, describe, expect, it } from "vitest";
import { getShowcaseAsset, getShowcaseAssets, isShowcaseName } from "./showcase-assets";

describe("showcase asset allowlist", () => {
  afterEach(() => {
    delete process.env.SHOWCASE_SCRIPT_STORAGE_KEY;
  });

  it("exposes exactly the three product showcases using stable same-origin routes", () => {
    expect(getShowcaseAssets().map(({ name, publicPath }) => ({ name, publicPath }))).toEqual([
      { name: "script", publicPath: "/api/showcase/script" },
      { name: "repurpose", publicPath: "/api/showcase/repurpose" },
      { name: "ugc", publicPath: "/api/showcase/ugc" },
    ]);
  });

  it("rejects names outside the explicit allowlist", () => {
    expect(isShowcaseName("script")).toBe(true);
    expect(isShowcaseName("backups")).toBe(false);
    expect(isShowcaseName("../script")).toBe(false);
  });

  it("rejects an unsafe configured storage key", () => {
    process.env.SHOWCASE_SCRIPT_STORAGE_KEY = "../backups/database.sql.gz";
    expect(() => getShowcaseAsset("script")).toThrow(/not a safe storage key/);
  });
});
