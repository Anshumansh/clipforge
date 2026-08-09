import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function requireUser() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/login");

  return user;
}

/** For server components (the admin page itself). API routes use the
 * inline getServerSession + fresh isAdmin lookup pattern instead (see
 * app/api/roadmap/[id]/status/route.ts) so they can return a JSON 401/403
 * rather than a redirect. */
export async function requireAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/dashboard");
  return user;
}
