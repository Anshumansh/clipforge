import { describe, it, expect } from "vitest";
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

  it("rejects a code generated from a different secret", () => {
    // Two independently random secrets producing the same 6-digit code at the
    // same 30s step (verifyTotpCode's window:1 tolerance means 3 valid codes
    // per secret at any instant) is a real, if tiny, ~3-in-a-million chance --
    // rare enough to look like a one-off CI flake, common enough to hit
    // eventually over a project's lifetime. Retry with a fresh secretB on the
    // vanishingly unlikely event of a genuine collision rather than asserting
    // on two draws that happened to coincide; this keeps the test exercising
    // real random secrets (real bugs in cross-secret scoping show up here)
    // instead of switching to a fixed pair, which would just relocate the
    // same coincidence risk to a single fixed pair.
    const secretA = generateTotpSecret();
    let codeFromB: string;
    let result: boolean;
    do {
      const secretB = generateTotpSecret();
      codeFromB = buildTotp(secretB.base32, "admin@example.com").generate();
      result = verifyTotpCode(secretA.base32, codeFromB, "admin@example.com");
    } while (result === true);

    expect(result).toBe(false);
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
