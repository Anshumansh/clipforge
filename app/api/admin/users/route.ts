import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveAdminUserId } from "@/lib/admin-auth";

export async function GET(req: Request) {
  const adminId = await resolveAdminUserId();
  if (!adminId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const search = new URL(req.url).searchParams.get("search")?.trim() ?? "";
  if (search.length < 2) return NextResponse.json({ users: [] });

  const users = await db.user.findMany({
    where: { email: { contains: search, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      email: true,
      name: true,
      plan: true,
      credits: true,
      isAdmin: true,
      compPlanExpiresAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ users });
}
