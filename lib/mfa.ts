import * as OTPAuth from "otpauth";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

const ISSUER = "Clipforge";
const BACKUP_CODE_COUNT = 8;

export function generateTotpSecret(): OTPAuth.Secret {
  return new OTPAuth.Secret({ size: 20 });
}

export function buildTotp(secretBase32: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

/** window: 1 tolerates the code just before/after the current 30s step, to
 * absorb ordinary clock drift between the server and the user's phone. */
export function verifyTotpCode(secretBase32: string, code: string, label: string): boolean {
  const totp = buildTotp(secretBase32, label);
  const delta = totp.validate({ token: code.trim(), window: 1 });
  return delta !== null;
}

/** Human-typeable backup codes (XXXX-XXXX), not the base32 secret itself --
 * shown to the admin exactly once at enrollment. Only the bcrypt hashes are
 * ever persisted. */
export function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const raw = crypto.randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
}

/** Returns the remaining hash list with the matched code's hash removed
 * (single-use), or null if no hash matched. */
export async function consumeBackupCode(hashes: string[], code: string): Promise<string[] | null> {
  const normalized = code.trim().toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(normalized, hashes[i])) {
      return [...hashes.slice(0, i), ...hashes.slice(i + 1)];
    }
  }
  return null;
}
