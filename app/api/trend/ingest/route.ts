import { NextResponse } from "next/server";
import { ingestChannels, getAllTrackedChannelsAndNiches } from "@/lib/trend/ingest";
import { isValidCronSecret } from "@/lib/cron-auth";

export const runtime = "nodejs";

/** Scheduled ingestion — run every 2-6h via cron (see scripts/process-trend-ingestion.sh),
 * same pattern as the existing scheduled-social-post processor. Not a user-facing route. */
export async function POST(req: Request) {
  if (!isValidCronSecret(req.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { channelIds, niches } = await getAllTrackedChannelsAndNiches();
    if (channelIds.length === 0 && niches.length === 0) {
      return NextResponse.json({ ok: true, summary: null, note: "No tracked channels or niches to ingest yet" });
    }
    const summary = await ingestChannels(channelIds, niches);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[trend-ingest] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Ingestion failed" }, { status: 500 });
  }
}
