import crypto from "node:crypto";

const KEY_PREFIX = "cf_live_";
/** How much of the raw key is kept visible in the UI after creation --
 * enough to recognize which key is which, nowhere near enough to guess
 * the rest (the secret portion is 32 random bytes). */
const VISIBLE_PREFIX_LENGTH = KEY_PREFIX.length + 6;

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const secret = crypto.randomBytes(32).toString("base64url");
  const raw = `${KEY_PREFIX}${secret}`;
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, VISIBLE_PREFIX_LENGTH) };
}

export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
