import { NextResponse } from "next/server";
import { getPresignedDownloadUrl } from "@/lib/storage";
import { db } from "@/lib/db";
import { resolveApiUser } from "@/lib/api-auth";
import { projectAccessFilter } from "@/lib/workspace";
import { getDemoUserId } from "@/lib/demo-user";
import { isValidInternalMediaSecret } from "@/lib/internal-auth";

export const runtime = "nodejs";

// scripts/backup-db.sh writes full database dumps to the same bucket under
// backups/db-<timestamp>.sql.gz — a predictable, guessable filename pattern.
// Hard-block anything outside these two upload conventions so a backup (or
// any other future non-media prefix) can never be served this way,
// regardless of what authorization logic follows.
//
// "media/<userId>/..." is the original upload convention (still what every
// pre-existing row's videoUrl points at); "jobs/<jobId>/attempts/<token>/..."
// is the attempt-scoped key every render has used since the
// queue-lifecycle-fencing pass (lib/jobs/media-fencing.ts).
const ALLOWED_PREFIXES = ["media/", "jobs/"];

/** Resolves a media key to the Project it belongs to, or null if the key
 * doesn't match a recognized, project-scoped shape. Segment-count and
 * literal-value checks are strict on purpose — anything that doesn't
 * exactly match falls through to null (fail closed), including path
 * traversal attempts (`..`/empty segments), unknown shapes, and future
 * prefixes nobody has taught this function about yet. */
async function resolveProjectId(segments: string[]): Promise<string | null> {
  if (segments.length === 5 && segments[0] === "jobs" && segments[2] === "attempts") {
    const job = await db.job.findUnique({ where: { id: segments[1] }, select: { projectId: true } });
    return job?.projectId ?? null;
  }
  if (segments.length === 4 && segments[0] === "media" && segments[2] !== "brand") {
    const [, userId, projectId] = segments;
    // Confirms the path's claimed ownership against the DB record rather
    // than trusting the URL segment itself.
    const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, userId: true } });
    return project && project.userId === userId ? project.id : null;
  }
  return null;
}

/** Authorization for a media key. Three tiers, checked in order:
 * 1. A trusted internal caller (the worker fetching its own job's source
 *    media server-to-server, no user session exists to check) — identified
 *    by a shared secret, not by anything derivable from the URL.
 * 2. Media belonging to the shared anonymous-demo account is intentionally
 *    public, matching the homepage try-before-signup design (no login
 *    required to watch a demo render, including the visitor who generated
 *    it).
 * 3. Everything else requires a real session (or API key) whose user owns
 *    the Project directly, or is a member of the workspace that owns it —
 *    resolved via projectAccessFilter, the same primitive every other
 *    project-scoped route in this codebase already uses. An unguessable
 *    path segment (attemptToken, cuid) is never treated as proof of
 *    authorization on its own. */
async function isAuthorized(req: Request, key: string, segments: string[]): Promise<boolean> {
  if (isValidInternalMediaSecret(req.headers.get("x-internal-media-secret"))) return true;

  if (segments.length === 4 && segments[0] === "media" && segments[2] === "brand") {
    const apiUser = await resolveApiUser(req);
    return apiUser?.userId === segments[1];
  }

  const projectId = await resolveProjectId(segments);
  if (!projectId) return false;

  const project = await db.project.findUnique({ where: { id: projectId }, select: { userId: true } });
  if (!project) return false;
  if (project.userId === (await getDemoUserId())) return true;

  const apiUser = await resolveApiUser(req);
  if (!apiUser) return false;

  const authorized = await db.project.findFirst({
    where: { id: projectId, ...(await projectAccessFilter(apiUser.userId)) },
    select: { id: true },
  });
  return !!authorized;
}

export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: keySegments } = await params;
  const segments = keySegments;
  const key = segments.join("/");

  if (
    !ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
    segments.some((s) => s === "" || s === "." || s === "..")
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!(await isAuthorized(req, key, segments))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = await getPresignedDownloadUrl(key);
  if (!url) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.redirect(url, { status: 307 });
}
