import { describe, it, expect } from "vitest";
import { canUseRepurpose, canUseSocialPublishing, canUseUgc } from "@/lib/plans";

describe("canUseRepurpose", () => {
  it("allows hobby plan", () => expect(canUseRepurpose("hobby")).toBe(true));
  it("allows creator plan", () => expect(canUseRepurpose("creator")).toBe(true));
  it("allows business plan", () => expect(canUseRepurpose("business")).toBe(true));
  it("blocks free plan", () => expect(canUseRepurpose("free")).toBe(false));
  it("blocks unknown plan strings", () => expect(canUseRepurpose("")).toBe(false));
});

describe("canUseUgc", () => {
  it("allows creator plan", () => expect(canUseUgc("creator")).toBe(true));
  it("allows business plan", () => expect(canUseUgc("business")).toBe(true));
  it("blocks hobby plan", () => expect(canUseUgc("hobby")).toBe(false));
  it("blocks free plan", () => expect(canUseUgc("free")).toBe(false));
  it("blocks unknown plan strings", () => expect(canUseUgc("")).toBe(false));
});

describe("canUseSocialPublishing", () => {
  it("allows legacy Hobby, Creator and Business accounts", () => {
    expect(canUseSocialPublishing("hobby")).toBe(true);
    expect(canUseSocialPublishing("creator")).toBe(true);
    expect(canUseSocialPublishing("business")).toBe(true);
  });

  it("blocks Free and unknown accounts", () => {
    expect(canUseSocialPublishing("free")).toBe(false);
    expect(canUseSocialPublishing("unknown")).toBe(false);
  });
});
