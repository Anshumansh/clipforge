import { NextResponse } from "next/server";
import { getPresignedDownloadUrl } from "@/lib/storage";

export const runtime = "nodejs";

// This route is intentionally unauthenticated — it also serves the real
// showcase videos embedded on the public marketing homepage, not just
// signed-in users' own dashboard media. Access control is "unguessable
// cuid()-keyed path", the same model S3/Drive "anyone with the link"
// sharing uses, not per-request ownership checks.
//
// That model only holds if every key under this bucket is meant to be
// reachable this way. It is NOT: scripts/backup-db.sh writes full database
// dumps to the same bucket under backups/db-<timestamp>.sql.gz — a
// predictable, guessable filename pattern — and this route would happily
// mint anyone a fresh presigned URL to one, no login required. Hard-block
// anything outside these prefixes so a backup (or any other future
// non-media prefix) can never be served this way, regardless of how
// unauthenticated this route stays.
//
// Two allowed prefixes, not one: "media/<userId>/..." is the original
// upload convention (still what every pre-existing row's videoUrl points
// at); "jobs/<jobId>/attempts/<attemptToken>/..." is the attempt-scoped
// key every render has used since the queue-lifecycle-fencing pass
// (lib/jobs/media-fencing.ts) -- omitting it here 404s every new
// generation's playback/download while leaving old ones unaffected,
// which is exactly the gap a real post-deploy verification job caught
// immediately after this route and media-fencing.ts were first deployed
// together.
const ALLOWED_PREFIXES = ["media/", "jobs/"];

export async function GET(_req: Request, { params }: { params: { key: string[] } }) {
  const key = params.key.join("/");
  if (!ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = await getPresignedDownloadUrl(key);
  if (!url) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.redirect(url, { status: 307 });
}
