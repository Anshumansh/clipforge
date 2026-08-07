import { PLATFORM_OAUTH, getRedirectUri, type SocialPlatform } from "./platforms";

export interface TokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresInSec?: number;
}

export interface ConnectedIdentity {
  platformUserId: string;
  handle: string | null;
}

// Each platform's token exchange is shaped just differently enough (form POST
// vs GET-with-query, different param names) that a fully generic helper would
// need more branching than just writing the three calls out directly.

async function exchangeYoutube(code: string): Promise<TokenResult> {
  const config = PLATFORM_OAUTH.youtube;
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env[config.clientIdEnv]!,
      client_secret: process.env[config.clientSecretEnv]!,
      code,
      grant_type: "authorization_code",
      redirect_uri: getRedirectUri("youtube"),
    }),
  });
  if (!res.ok) throw new Error(`YouTube token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresInSec: data.expires_in };
}

async function exchangeTiktok(code: string): Promise<TokenResult> {
  const config = PLATFORM_OAUTH.tiktok;
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env[config.clientIdEnv]!,
      client_secret: process.env[config.clientSecretEnv]!,
      code,
      grant_type: "authorization_code",
      redirect_uri: getRedirectUri("tiktok"),
    }),
  });
  if (!res.ok) throw new Error(`TikTok token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresInSec: data.expires_in };
}

async function exchangeInstagram(code: string): Promise<TokenResult> {
  const config = PLATFORM_OAUTH.instagram;
  const url = new URL(config.tokenUrl);
  url.searchParams.set("client_id", process.env[config.clientIdEnv]!);
  url.searchParams.set("client_secret", process.env[config.clientSecretEnv]!);
  url.searchParams.set("code", code);
  url.searchParams.set("redirect_uri", getRedirectUri("instagram"));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Instagram token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  // Meta's short-lived token from this step should be exchanged for a
  // long-lived one before storing — left for the real integration once an
  // app is registered, since the exact flow depends on Business vs personal
  // account setup.
  return { accessToken: data.access_token, expiresInSec: data.expires_in };
}

export async function exchangeCodeForToken(platform: SocialPlatform, code: string): Promise<TokenResult> {
  if (platform === "youtube") return exchangeYoutube(code);
  if (platform === "tiktok") return exchangeTiktok(code);
  return exchangeInstagram(code);
}

async function identifyYoutube(accessToken: string): Promise<ConnectedIdentity> {
  const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`YouTube channel lookup failed: ${res.status}`);
  const data = await res.json();
  const channel = data.items?.[0];
  return { platformUserId: channel?.id ?? "unknown", handle: channel?.snippet?.title ?? null };
}

async function identifyTiktok(accessToken: string): Promise<ConnectedIdentity> {
  const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`TikTok user lookup failed: ${res.status}`);
  const data = await res.json();
  const user = data.data?.user;
  return { platformUserId: user?.open_id ?? "unknown", handle: user?.display_name ?? null };
}

async function identifyInstagram(accessToken: string): Promise<ConnectedIdentity> {
  // Instagram business accounts are addressed through the Facebook Page that
  // manages them — resolving that Page/IG-user-id pair here would depend on
  // which Pages/accounts the user's token has access to, verified once a real
  // Meta app + Business account is available to test against.
  const res = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${accessToken}`);
  if (!res.ok) throw new Error(`Instagram/Meta identity lookup failed: ${res.status}`);
  const data = await res.json();
  return { platformUserId: data.id ?? "unknown", handle: data.name ?? null };
}

export async function identifyConnectedAccount(platform: SocialPlatform, accessToken: string): Promise<ConnectedIdentity> {
  if (platform === "youtube") return identifyYoutube(accessToken);
  if (platform === "tiktok") return identifyTiktok(accessToken);
  return identifyInstagram(accessToken);
}
