import { NextResponse } from "next/server";
import packageJson from "@/package.json";

// Deliberately narrow: this exists so CI can prove staging is actually
// running the commit it just deployed (see .github/workflows/e2e.yml's
// preflight job) without ever touching Railway's variable-listing API,
// which returns full plaintext for every env var on the service. Every
// field here is build/deploy metadata, not application configuration --
// none of it is a secret, and nothing else from process.env is ever
// forwarded through this route.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    gitSha: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? null,
    version: packageJson.version,
  });
}
