export type SocialPlatform = "youtube" | "tiktok" | "instagram";

export const SOCIAL_PLATFORMS: SocialPlatform[] = ["youtube", "tiktok", "instagram"];

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  youtube: "YouTube Shorts",
  tiktok: "TikTok",
  instagram: "Instagram Reels",
};

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return value === "youtube" || value === "tiktok" || value === "instagram";
}

interface PlatformOAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Google/TikTok/Meta all differ slightly in how they expect the auth request shaped. */
  extraAuthorizeParams?: Record<string, string>;
}

// Endpoints/scopes per each platform's official developer docs as of this
// build. OAuth surfaces do shift over time — re-check against current docs
// when registering the app, not just trusting this file blindly.
export const PLATFORM_OAUTH: Record<SocialPlatform, PlatformOAuthConfig> = {
  youtube: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
    clientIdEnv: "YOUTUBE_CLIENT_ID",
    clientSecretEnv: "YOUTUBE_CLIENT_SECRET",
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  },
  tiktok: {
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["video.publish", "user.info.basic"],
    clientIdEnv: "TIKTOK_CLIENT_KEY",
    clientSecretEnv: "TIKTOK_CLIENT_SECRET",
  },
  instagram: {
    authorizeUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list", "business_management"],
    clientIdEnv: "META_APP_ID",
    clientSecretEnv: "META_APP_SECRET",
  },
};

export function isPlatformConfigured(platform: SocialPlatform): boolean {
  const config = PLATFORM_OAUTH[platform];
  return Boolean(process.env[config.clientIdEnv] && process.env[config.clientSecretEnv]);
}

export type PlatformCapabilityState = "unavailable" | "awaiting_approval" | "beta" | "live";

/** Single source of truth for what marketing/product copy is allowed to claim
 * about a platform's publishing capability -- every page should derive its
 * wording from this instead of hardcoding "auto-publish everywhere" style
 * claims that can drift out of sync with what's actually configured.
 *
 * - unavailable: explicitly disabled via SOCIAL_<PLATFORM>_DISABLED kill switch.
 * - awaiting_approval: OAuth app credentials aren't configured on this server
 *   yet (the common case pre-launch -- the developer app is still pending
 *   platform review, or was never registered).
 * - beta: credentials are configured (OAuth connect works) but nobody has
 *   set SOCIAL_<PLATFORM>_VERIFIED_LIVE -- i.e. a real end-to-end publish
 *   hasn't been manually confirmed yet.
 * - live: configured AND manually confirmed working. Only ever set by
 *   flipping the env var after an owner actually verifies a real publish --
 *   never inferred automatically, so this can't silently claim "live"
 *   the moment credentials are dropped in. */
export function getPlatformCapability(platform: SocialPlatform): PlatformCapabilityState {
  if (process.env[`SOCIAL_${platform.toUpperCase()}_DISABLED`] === "true") return "unavailable";
  if (!isPlatformConfigured(platform)) return "awaiting_approval";
  return process.env[`SOCIAL_${platform.toUpperCase()}_VERIFIED_LIVE`] === "true" ? "live" : "beta";
}

export function getLivePlatforms(): SocialPlatform[] {
  return SOCIAL_PLATFORMS.filter((p) => getPlatformCapability(p) === "live");
}

export const PLATFORM_CAPABILITY_LABEL: Record<PlatformCapabilityState, string> = {
  unavailable: "Temporarily unavailable",
  awaiting_approval: "In platform approval",
  beta: "Beta",
  live: "Live",
};

export function getRedirectUri(platform: SocialPlatform): string {
  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/social/callback/${platform}`;
}
