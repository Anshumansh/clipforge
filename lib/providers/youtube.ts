const BASE_URL = "https://www.googleapis.com/youtube/v3";
const TIMEOUT_MS = 15000;

export interface ChannelInfo {
  id: string;
  title: string;
  uploadsPlaylistId: string;
  subscriberCount: number;
}

export interface VideoStats {
  id: string;
  channelId: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
}

function apiKey(): string {
  const key = process.env.YOUTUBE_DATA_API_KEY;
  if (!key) throw new Error("YOUTUBE_DATA_API_KEY not set");
  return key;
}

async function getJson(path: string, params: Record<string, string>): Promise<Record<string, unknown> | null> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey());

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`[youtube] ${path} failed: ${res.status} ${await res.text().catch(() => "")}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[youtube] ${path} threw:`, err instanceof Error ? err.message : err);
    return null;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 1 quota unit per call, up to 50 channel IDs each. */
export async function getChannelsInfo(channelIds: string[]): Promise<ChannelInfo[]> {
  const out: ChannelInfo[] = [];
  for (const batch of chunk(channelIds, 50)) {
    const data = await getJson("/channels", { part: "snippet,statistics,contentDetails", id: batch.join(",") });
    const items = (data?.items as Record<string, unknown>[] | undefined) ?? [];
    for (const item of items) {
      const snippet = item.snippet as Record<string, unknown> | undefined;
      const stats = item.statistics as Record<string, unknown> | undefined;
      const contentDetails = item.contentDetails as Record<string, unknown> | undefined;
      const relatedPlaylists = contentDetails?.relatedPlaylists as Record<string, unknown> | undefined;
      const uploadsPlaylistId = relatedPlaylists?.uploads;
      if (typeof item.id !== "string" || typeof uploadsPlaylistId !== "string") continue;
      out.push({
        id: item.id,
        title: typeof snippet?.title === "string" ? snippet.title : "",
        uploadsPlaylistId,
        subscriberCount: Number(stats?.subscriberCount ?? 0),
      });
    }
  }
  return out;
}

/** 1 quota unit per call — the cheap way to get a channel's recent videos, vs.
 * search.list's 100 units. */
export async function getRecentVideoIds(uploadsPlaylistId: string, maxResults = 10): Promise<string[]> {
  const data = await getJson("/playlistItems", {
    part: "contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: String(maxResults),
  });
  const items = (data?.items as Record<string, unknown>[] | undefined) ?? [];
  return items
    .map((item) => (item.contentDetails as Record<string, unknown> | undefined)?.videoId)
    .filter((id): id is string => typeof id === "string");
}

/** 1 quota unit per call, up to 50 video IDs each — snippet + statistics in one shot. */
export async function getVideosStats(videoIds: string[]): Promise<VideoStats[]> {
  const out: VideoStats[] = [];
  for (const batch of chunk(videoIds, 50)) {
    if (batch.length === 0) continue;
    const data = await getJson("/videos", { part: "snippet,statistics", id: batch.join(",") });
    const items = (data?.items as Record<string, unknown>[] | undefined) ?? [];
    for (const item of items) {
      const snippet = item.snippet as Record<string, unknown> | undefined;
      const stats = item.statistics as Record<string, unknown> | undefined;
      const thumbnails = snippet?.thumbnails as Record<string, unknown> | undefined;
      const thumb = (thumbnails?.high ?? thumbnails?.medium ?? thumbnails?.default) as
        | Record<string, unknown>
        | undefined;
      if (typeof item.id !== "string" || !snippet) continue;
      out.push({
        id: item.id,
        channelId: typeof snippet.channelId === "string" ? snippet.channelId : "",
        title: typeof snippet.title === "string" ? snippet.title : "",
        description: typeof snippet.description === "string" ? snippet.description : "",
        thumbnailUrl: typeof thumb?.url === "string" ? thumb.url : null,
        publishedAt: typeof snippet.publishedAt === "string" ? snippet.publishedAt : new Date().toISOString(),
        views: Number(stats?.viewCount ?? 0),
        likes: Number(stats?.likeCount ?? 0),
        comments: Number(stats?.commentCount ?? 0),
      });
    }
  }
  return out;
}

/** 100 quota units per call — only used for niche-based discovery of videos outside
 * a user's explicitly tracked channels, not for routine tracked-channel refreshes. */
export async function searchByNiche(niche: string, maxResults = 15): Promise<string[]> {
  const data = await getJson("/search", {
    part: "id",
    q: niche,
    type: "video",
    order: "viewCount",
    publishedAfter: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    maxResults: String(maxResults),
  });
  const items = (data?.items as Record<string, unknown>[] | undefined) ?? [];
  return items
    .map((item) => (item.id as Record<string, unknown> | undefined)?.videoId)
    .filter((id): id is string => typeof id === "string");
}

export interface ResolvedChannel {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  subscriberCount: number;
}

/** Accepts whatever a user is likely to paste — a full channel URL in any of
 * YouTube's formats, a bare @handle, or a raw channel ID — and resolves it to
 * a real channel via the official API. 1 quota unit. Returns null if nothing
 * matches (typo'd handle, private/deleted channel, garbage input). */
export async function resolveChannel(input: string): Promise<ResolvedChannel | null> {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let idParam: { id: string } | null = null;
  let handleParam: { forHandle: string } | null = null;

  const directIdMatch = trimmed.match(/^UC[\w-]{22}$/);
  const urlChannelMatch = trimmed.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  const urlHandleMatch = trimmed.match(/youtube\.com\/(?:@|c\/|user\/)([\w.-]+)/);
  const bareHandleMatch = trimmed.match(/^@?([\w.-]+)$/);

  if (directIdMatch) {
    idParam = { id: directIdMatch[0] };
  } else if (urlChannelMatch) {
    idParam = { id: urlChannelMatch[1] };
  } else if (urlHandleMatch) {
    handleParam = { forHandle: `@${urlHandleMatch[1]}` };
  } else if (bareHandleMatch) {
    handleParam = { forHandle: `@${bareHandleMatch[1]}` };
  } else {
    return null;
  }

  const data = await getJson("/channels", {
    part: "snippet,statistics",
    ...(idParam ?? handleParam!),
  });

  const item = (data?.items as Record<string, unknown>[] | undefined)?.[0];
  if (!item || typeof item.id !== "string") return null;

  const snippet = item.snippet as Record<string, unknown> | undefined;
  const stats = item.statistics as Record<string, unknown> | undefined;
  const thumbnails = snippet?.thumbnails as Record<string, unknown> | undefined;
  const thumb = (thumbnails?.default ?? thumbnails?.medium) as Record<string, unknown> | undefined;

  return {
    id: item.id,
    title: typeof snippet?.title === "string" ? snippet.title : trimmed,
    thumbnailUrl: typeof thumb?.url === "string" ? thumb.url : null,
    subscriberCount: Number(stats?.subscriberCount ?? 0),
  };
}
