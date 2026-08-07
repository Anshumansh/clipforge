import { decrypt } from "@/lib/crypto";
import type { SocialAccount } from "@prisma/client";

export interface PublishResult {
  platformPostId: string;
}

// Real upload mechanics per platform, to the best of current official docs.
// None of this has been exercised against a live app — that needs a real
// registered app + test account per platform (see OPERATIONS.md). The shapes
// below are what each platform's docs specify; re-verify against current docs
// when actually testing, since these APIs do shift.

async function publishToYoutube(account: SocialAccount, videoUrl: string, caption: string): Promise<PublishResult> {
  const accessToken = decrypt(account.accessTokenEnc);
  const title = caption.slice(0, 100) || "Shorts video";
  const description = caption.slice(0, 5000);

  const initRes = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": "video/mp4",
    },
    body: JSON.stringify({
      snippet: { title, description },
      status: { privacyStatus: "public" },
    }),
  });
  if (!initRes.ok) throw new Error(`YouTube upload init failed: ${initRes.status} ${await initRes.text()}`);

  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not return a resumable upload URL");

  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok || !videoRes.body) throw new Error(`Could not fetch rendered video for upload: ${videoRes.status}`);

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: videoRes.body as never,
    duplex: "half",
  } as RequestInit);
  if (!uploadRes.ok) throw new Error(`YouTube upload failed: ${uploadRes.status} ${await uploadRes.text()}`);

  const data = await uploadRes.json();
  return { platformPostId: data.id };
}

async function publishToTiktok(account: SocialAccount, videoUrl: string, caption: string): Promise<PublishResult> {
  const accessToken = decrypt(account.accessTokenEnc);

  // TikTok's Content Posting API can pull directly from a URL rather than
  // needing us to stream bytes through our own server — our /api/media proxy
  // URL works here as long as it's reachable from TikTok's servers within the
  // presigned URL's validity window (1hr by default; see lib/storage.ts).
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      post_info: {
        title: caption.slice(0, 150),
        privacy_level: "PUBLIC_TO_EVERYONE",
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: videoUrl,
      },
    }),
  });
  if (!res.ok) throw new Error(`TikTok publish init failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  if (data.error?.code && data.error.code !== "ok") throw new Error(`TikTok publish failed: ${JSON.stringify(data.error)}`);
  return { platformPostId: data.data?.publish_id ?? "unknown" };
}

async function publishToInstagram(account: SocialAccount, videoUrl: string, caption: string): Promise<PublishResult> {
  const accessToken = decrypt(account.accessTokenEnc);
  const igUserId = account.platformUserId;

  // Two-step publish: create a media container, then publish it once Meta's
  // servers finish processing the video (polled via status_code).
  const createRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "REELS",
      video_url: videoUrl,
      caption: caption.slice(0, 2200),
      access_token: accessToken,
    }),
  });
  if (!createRes.ok) throw new Error(`Instagram container creation failed: ${createRes.status} ${await createRes.text()}`);
  const { id: containerId } = await createRes.json();

  const maxAttempts = 20;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusRes = await fetch(
      `https://graph.facebook.com/v19.0/${containerId}?fields=status_code&access_token=${accessToken}`
    );
    const status = await statusRes.json();
    if (status.status_code === "FINISHED") break;
    if (status.status_code === "ERROR") throw new Error("Instagram media processing failed");
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  const publishRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
  });
  if (!publishRes.ok) throw new Error(`Instagram publish failed: ${publishRes.status} ${await publishRes.text()}`);
  const data = await publishRes.json();
  return { platformPostId: data.id };
}

export async function publishToSocial(account: SocialAccount, videoUrl: string, caption: string): Promise<PublishResult> {
  if (account.platform === "youtube") return publishToYoutube(account, videoUrl, caption);
  if (account.platform === "tiktok") return publishToTiktok(account, videoUrl, caption);
  if (account.platform === "instagram") return publishToInstagram(account, videoUrl, caption);
  throw new Error(`Unknown platform: ${account.platform}`);
}
