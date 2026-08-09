import { db } from "@/lib/db";

const DEMO_EMAIL = "demo@internal.forgecut.app";

// A syntactically valid bcrypt hash with no known plaintext — same pattern
// as the DUMMY_HASH used for timing-safe login comparisons in lib/auth.ts.
// A raw random string would fail bcrypt.compare() the same way, but this
// avoids depending on that being true for every bcrypt implementation.
const UNUSABLE_PASSWORD_HASH = "$2a$10$D9dE01KqVmMAizvUyCltz.yB5G210EGvxW79ZAgg1PCvYkHh.t8N.";

let cachedId: string | null = null;

/** A single shared account every anonymous homepage demo generation is
 * attributed to — reuses the entire existing script-to-video pipeline
 * (Project/Job/queue/renderer) instead of a parallel one. Its password hash
 * is a random value nobody has, so it can never actually be logged into;
 * abuse is controlled by IP rate limiting in the demo route, not by this
 * account's own (bypassed) credits. */
export async function getDemoUserId(): Promise<string> {
  if (cachedId) return cachedId;

  const existing = await db.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true } });
  if (existing) {
    cachedId = existing.id;
    return existing.id;
  }

  const created = await db.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Homepage demo",
      passwordHash: UNUSABLE_PASSWORD_HASH,
      plan: "free",
    },
    select: { id: true },
  });
  cachedId = created.id;
  return created.id;
}
