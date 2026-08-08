import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkStorageHealth, isRemoteStorageConfigured } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export async function GET() {
  const checks: Record<string, boolean> = {};

  try {
    await withTimeout(db.$queryRaw`SELECT 1`, 5000);
    checks.database = true;
  } catch {
    checks.database = false;
  }

  if (isRemoteStorageConfigured()) {
    try {
      checks.storage = await withTimeout(checkStorageHealth(), 5000);
    } catch {
      checks.storage = false;
    }
  } else {
    checks.storage = false;
  }

  const healthy = Object.values(checks).every(Boolean);

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 }
  );
}
