import { NextResponse } from "next/server";

// Liveness only: "is this process running and able to answer" -- no DB call,
// no storage call, no I/O of any kind. Deliberately separate from
// /api/health (readiness/deep-health: DB + storage, ~5s timeouts each),
// which stays exactly as-is since Docker's healthcheck, scripts/watchdog.sh,
// and deploy.yml's post-deploy check already depend on its existing
// contract. This endpoint exists for a future load balancer or orchestrator
// that needs a liveness probe cheap enough to poll every few seconds without
// ever putting load on the database.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: "alive", timestamp: new Date().toISOString() }, { status: 200 });
}
