import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

/** Looked up fresh rather than carried on the JWT -- admin actions are
 * low-frequency, not worth widening the session token's surface area for
 * (same reasoning as the roadmap status route this pattern is copied from). */
export async function resolveAdminUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return null;

  const user = await db.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  return user?.isAdmin ? userId : null;
}
