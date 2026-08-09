import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isValidCronSecret } from "@/lib/cron-auth";
import { getDemoUserId } from "@/lib/demo-user";
import { deleteMediaByPrefix } from "@/lib/storage";

export const runtime = "nodejs";

// Anonymous homepage demo generations have no account behind them to ever
// come back and delete their own data, so unlike real users' media (kept
// until they delete their account) this needs to expire on a timer, or it
// grows unbounded on storage nobody is paying for. Nobody needs a demo
// clip more than a day after generating it — the CTA on a finished demo
// already pushes toward signing up if they want to keep it.
const RETENTION_HOURS = 24;

export async function POST(req: Request) {
  if (!isValidCronSecret(req.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const demoUserId = await getDemoUserId();
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);

  const stale = await db.project.findMany({
    where: { userId: demoUserId, createdAt: { lt: cutoff } },
    select: { id: true },
  });

  for (const project of stale) {
    await deleteMediaByPrefix(`media/${demoUserId}/${project.id}/`);
  }

  // Deletes Jobs via onDelete: Cascade on Job.project.
  const { count } = await db.project.deleteMany({
    where: { id: { in: stale.map((p) => p.id) } },
  });

  return NextResponse.json({ deleted: count });
}
