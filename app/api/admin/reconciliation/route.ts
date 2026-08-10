import { NextResponse } from "next/server";
import { resolveAdminUserId } from "@/lib/admin-auth";
import { reconcileSubscriptions } from "@/lib/stripe-reconciliation";

export const runtime = "nodejs";

export async function GET() {
  const adminId = await resolveAdminUserId();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const result = await reconcileSubscriptions();
  return NextResponse.json(result);
}
