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
// anything outside media/ so a backup (or any other future non-media
// prefix) can never be served this way, regardless of how unauthenticated
// this route stays.
const ALLOWED_PREFIX = "media/";

export async function GET(_req: Request, { params }: { params: { key: string[] } }) {
  const key = params.key.join("/");
  if (!key.startsWith(ALLOWED_PREFIX)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = await getPresignedDownloadUrl(key);
  if (!url) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.redirect(url, { status: 307 });
}
