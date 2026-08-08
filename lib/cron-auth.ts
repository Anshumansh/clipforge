import crypto from "node:crypto";

/** Compares a request's cron-secret header against CRON_SECRET without a
 * timing side-channel. Plain `===` on secrets is a known bad practice —
 * the comparison exits as soon as a byte differs, so the response time
 * leaks how many leading characters an attacker got right. Hashing both
 * sides to a fixed-length digest first also sidesteps timingSafeEqual's
 * length-mismatch throw when the provided value doesn't match the
 * secret's length. */
export function isValidCronSecret(provided: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided) return false;

  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  const providedHash = crypto.createHash("sha256").update(provided).digest();
  return crypto.timingSafeEqual(expectedHash, providedHash);
}
