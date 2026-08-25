import path from "node:path";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { uploadBuffer } from "@/lib/storage";
import { isBrandFontKey, isHexColor } from "@/lib/brand";
import { canUseBrandKit } from "@/lib/plans";

export const runtime = "nodejs";

const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5MB

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [kit, user] = await Promise.all([
    db.brandKit.findUnique({ where: { userId } }),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } }),
  ]);

  return NextResponse.json({
    logoUrl: kit?.logoUrl ?? null,
    primaryColor: kit?.primaryColor ?? null,
    secondaryColor: kit?.secondaryColor ?? null,
    fontFamily: kit?.fontFamily ?? null,
    canApply: canUseBrandKit(user.plan),
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({ where: { id: userId }, select: { plan: true } });
  if (!user || !canUseBrandKit(user.plan)) {
    return NextResponse.json({ error: "Brand kit is a Business-plan feature" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const primaryColorRaw = form.get("primaryColor");
  const secondaryColorRaw = form.get("secondaryColor");
  const fontFamilyRaw = form.get("fontFamily");
  const removeLogo = form.get("removeLogo") === "true";
  const logo = form.get("logo");

  const primaryColor = primaryColorRaw ? String(primaryColorRaw) : null;
  const secondaryColor = secondaryColorRaw ? String(secondaryColorRaw) : null;
  const fontFamily = fontFamilyRaw ? String(fontFamilyRaw) : null;

  if (primaryColor !== null && !isHexColor(primaryColor)) {
    return NextResponse.json({ error: "Primary color must be a hex value like #7c3aed" }, { status: 400 });
  }
  if (secondaryColor !== null && !isHexColor(secondaryColor)) {
    return NextResponse.json({ error: "Secondary color must be a hex value like #ec4899" }, { status: 400 });
  }
  if (fontFamily !== null && !isBrandFontKey(fontFamily)) {
    return NextResponse.json({ error: "Invalid font selection" }, { status: 400 });
  }

  let logoUrl: string | null | undefined; // undefined = leave unchanged
  if (removeLogo) {
    logoUrl = null;
  } else if (logo instanceof File && logo.size > 0) {
    if (!logo.type.startsWith("image/")) {
      return NextResponse.json({ error: "Logo must be an image file" }, { status: 400 });
    }
    if (logo.size > MAX_LOGO_BYTES) {
      return NextResponse.json({ error: "Logo too large (max 5MB)" }, { status: 400 });
    }
    const ext = path.extname(logo.name || "") || ".png";
    const buffer = Buffer.from(await logo.arrayBuffer());
    logoUrl = await uploadBuffer(buffer, `media/${userId}/brand/logo-${Date.now()}${ext}`, logo.type);
  }

  const kit = await db.brandKit.upsert({
    where: { userId },
    create: {
      userId,
      logoUrl: logoUrl ?? null,
      primaryColor,
      secondaryColor,
      fontFamily,
    },
    update: {
      ...(logoUrl !== undefined ? { logoUrl } : {}),
      primaryColor,
      secondaryColor,
      fontFamily,
    },
  });

  return NextResponse.json({
    logoUrl: kit.logoUrl,
    primaryColor: kit.primaryColor,
    secondaryColor: kit.secondaryColor,
    fontFamily: kit.fontFamily,
  });
}
