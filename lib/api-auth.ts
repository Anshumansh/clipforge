import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/api-keys";
import { canUseApiAccess } from "@/lib/plans";

export interface ApiUser {
  userId: string;
  plan: string;
  /** True when authenticated via an Authorization: Bearer <api-key> header
   * rather than the normal session cookie -- lets a route apply the
   * Business-plan API-access gate only to actual API callers, not to the
   * web dashboard's own session-authenticated requests. */
  viaApiKey: boolean;
}

/** Resolves the calling user from either a session cookie (web dashboard)
 * or an `Authorization: Bearer <api-key>` header (MCP server / API
 * clients) -- lets existing routes serve both without duplicating logic.
 * A Bearer key belonging to a user whose plan no longer includes API
 * access (e.g. downgraded since the key was created) resolves to null,
 * same as an invalid key. */
export async function resolveApiUser(req: Request): Promise<ApiUser | null> {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const raw = authHeader.slice(7).trim();
    if (!raw) return null;

    const key = await db.apiKey.findUnique({
      where: { keyHash: hashApiKey(raw) },
      include: { user: { select: { plan: true } } },
    });
    if (!key || !canUseApiAccess(key.user.plan)) return null;

    void db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    return { userId: key.userId, plan: key.user.plan, viaApiKey: true };
  }

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return null;

  const user = await db.user.findUnique({ where: { id: userId }, select: { plan: true } });
  if (!user) return null;

  return { userId, plan: user.plan, viaApiKey: false };
}
