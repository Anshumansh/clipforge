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
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const codeFromB = buildTotp(secretB.base32, "admin@example.com").generate();

    expect(verifyTotpCode(secretA.base32, codeFromB, "admin@example.com")).toBe(false);
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
