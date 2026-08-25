import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { isSocialPlatform } from "@/lib/social/platforms";
import { exchangeCodeForToken, identifyConnectedAccount } from "@/lib/social/oauth";
import { canUseSocialPublishing } from "@/lib/plans";

export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform: platformParam } = await params;
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isSocialPlatform(platformParam)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }
  const platform = platformParam;

  const user = await db.user.findUnique({ where: { id: userId }, select: { plan: true } });
  if (!user || !canUseSocialPublishing(user.plan)) {
    return NextResponse.json({ error: "Social publishing is available on Creator and Business" }, { status: 403 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const settingsUrl = new URL("/dashboard/settings", process.env.NEXTAUTH_URL ?? "http://localhost:3000");

  if (oauthError) {
    settingsUrl.searchParams.set("social_error", oauthError);
    return NextResponse.redirect(settingsUrl.toString());
  }

  const cookieName = `social_oauth_state_${platform}`;
  const savedState = req.headers
    .get("cookie")
    ?.split("; ")
    .find((c) => c.startsWith(`${cookieName}=`))
    ?.split("=")[1];

  if (!code || !state || !savedState || state !== savedState) {
    settingsUrl.searchParams.set("social_error", "invalid_state");
    return NextResponse.redirect(settingsUrl.toString());
  }

  try {
    const token = await exchangeCodeForToken(platform, code);
    const identity = await identifyConnectedAccount(platform, token.accessToken);

    await db.socialAccount.upsert({
      where: { userId_platform: { userId, platform } },
      create: {
        userId,
        platform,
        platformUserId: identity.platformUserId,
        handle: identity.handle,
        accessTokenEnc: encrypt(token.accessToken),
        refreshTokenEnc: token.refreshToken ? encrypt(token.refreshToken) : null,
        expiresAt: token.expiresInSec ? new Date(Date.now() + token.expiresInSec * 1000) : null,
      },
      update: {
        platformUserId: identity.platformUserId,
        handle: identity.handle,
        accessTokenEnc: encrypt(token.accessToken),
        refreshTokenEnc: token.refreshToken ? encrypt(token.refreshToken) : undefined,
        expiresAt: token.expiresInSec ? new Date(Date.now() + token.expiresInSec * 1000) : null,
      },
    });

    settingsUrl.searchParams.set("social_connected", platform);
  } catch (err) {
    console.error(`[social] ${platform} connect failed:`, err instanceof Error ? err.message : err);
    settingsUrl.searchParams.set("social_error", "connect_failed");
  }

  const res = NextResponse.redirect(settingsUrl.toString());
  res.cookies.delete(cookieName);
  return res;
}
