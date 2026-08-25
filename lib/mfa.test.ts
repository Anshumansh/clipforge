import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateTotpSecret,
  buildTotp,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
} from "./mfa";

describe("TOTP", () => {
  it("accepts the code an authenticator app would currently generate for the same secret", () => {
    const secret = generateTotpSecret();
    const totp = buildTotp(secret.base32, "admin@example.com");
    const currentCode = totp.generate();

    expect(verifyTotpCode(secret.base32, currentCode, "admin@example.com")).toBe(true);
  });

  it("rejects a code that doesn't match the secret", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret.base32, "000000", "admin@example.com")).toBe(false);
  });

  describe("cross-secret rejection", () => {
    // Two independently random secrets producing the same 6-digit code at the
    // same 30s step (verifyTotpCode's window:1 tolerance means 3 valid codes
    // per secret at any instant) is a real, if tiny, ~3-in-a-million chance --
    // rare enough to look like a one-off CI flake, common enough to hit
    // eventually over a project's lifetime, and a retry-until-non-colliding
    // loop is still nondeterministic in the strict sense (unbounded in
    // principle, however astronomically unlikely in practice). Fixed secrets
    // plus a frozen clock removes randomness from the test entirely: every
    // input is a constant, so the result is the same on every run forever,
    // not just "very likely" the same. FIXED_TIME/SECRET_A/SECRET_B were
    // verified once (see git history) to produce genuinely different codes,
    // including across the full window:1 tolerance range (-30s/0s/+30s) --
    // this isn't "probably fine", it's a checked, fixed fact about these
    // exact constants that can never change.
    const FIXED_TIME = new Date("2026-01-01T00:00:00Z");
    const SECRET_A = "JBSWY3DPEHPK3PXP";
    const SECRET_B = "KRSXG5CTMVRXEZLU";

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(FIXED_TIME);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("rejects a code generated from a different secret", () => {
      const codeFromB = buildTotp(SECRET_B, "admin@example.com").generate();
      expect(verifyTotpCode(SECRET_A, codeFromB, "admin@example.com")).toBe(false);
    });

    it("does still accept the matching secret's own code at the same instant (sanity check on the fixed vectors)", () => {
      const codeFromA = buildTotp(SECRET_A, "admin@example.com").generate();
      expect(verifyTotpCode(SECRET_A, codeFromA, "admin@example.com")).toBe(true);
    });
  });
});

describe("backup codes", () => {
  it("generates 8 codes in XXXXX-XXXXX format", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(8);
    for (const c of codes) expect(c).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
  });

  it("consumes exactly one matching code and leaves the rest usable", async () => {
    const codes = generateBackupCodes();
    const hashes = await hashBackupCodes(codes);

    const remaining = await consumeBackupCode(hashes, codes[2]);
    expect(remaining).not.toBeNull();
    expect(remaining).toHaveLength(hashes.length - 1);

    // The consumed code no longer matches anything in what's left.
    const secondAttempt = await consumeBackupCode(remaining!, codes[2]);
    expect(secondAttempt).toBeNull();

    // A different, still-unused code still works.
    const stillGood = await consumeBackupCode(remaining!, codes[5]);
    expect(stillGood).not.toBeNull();
  });

  it("returns null for a code that was never issued", async () => {
    const hashes = await hashBackupCodes(generateBackupCodes());
    expect(await consumeBackupCode(hashes, "AAAAA-AAAAA")).toBeNull();
  });
});
