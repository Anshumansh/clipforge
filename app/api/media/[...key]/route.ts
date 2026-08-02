import { NextResponse } from "next/server";
import { getPresignedDownloadUrl } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { key: string[] } }) {
  const key = params.key.join("/");

  const url = await getPresignedDownloadUrl(key);
  if (!url) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.redirect(url, { status: 307 });
}
