import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isSocialPlatform, isPlatformConfigured, PLATFORM_OAUTH, getRedirectUri } from "@/lib/social/platforms";
import { requireVerifiedEmail, EmailNotVerifiedError } from "@/lib/email-verification";

export async function GET(req: Request, { params }: { params: { platform: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await requireVerifiedEmail(userId);
  } catch (err) {
    if (err instanceof EmailNotVerifiedError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  if (!isSocialPlatform(params.platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }
  const platform = params.platform;

  if (!isPlatformConfigured(platform)) {
    return NextResponse.json({ error: `${platform} isn't configured on this server yet` }, { status: 501 });
  }

  const config = PLATFORM_OAUTH[platform];
  const clientId = process.env[config.clientIdEnv]!;
  const state = crypto.randomBytes(24).toString("hex");

  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", getRedirectUri(platform));
  url.searchParams.set("scope", config.scopes.join(platform === "tiktok" ? "," : " "));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  for (const [key, value] of Object.entries(config.extraAuthorizeParams ?? {})) {
    url.searchParams.set(key, value);
  }
  // TikTok's authorize endpoint expects the client id under this name instead.
  if (platform === "tiktok") url.searchParams.set("client_key", clientId);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set(`social_oauth_state_${platform}`, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
