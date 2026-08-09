import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiUser } from "@/lib/api-auth";

export async function GET(req: Request) {
  const apiUser = await resolveApiUser(req);
  if (!apiUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUniqueOrThrow({
    where: { id: apiUser.userId },
    select: { email: true, credits: true, plan: true },
  });

  return NextResponse.json(user);
}
