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

export function getRedirectUri(platform: SocialPlatform): string {
  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/social/callback/${platform}`;
}
