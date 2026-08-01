import type { BrollScene } from "./types";

const GRADIENT_PALETTES: [string, string][] = [
  ["#7c3aed", "#ec4899"],
  ["#2563eb", "#7c3aed"],
  ["#0891b2", "#2563eb"],
  ["#db2777", "#f97316"],
  ["#059669", "#0891b2"],
  ["#9333ea", "#db2777"],
];

interface PexelsVideoFile {
  quality: string | null;
  file_type: string;
  width: number;
  height: number;
  link: string;
}

async function fetchPexelsVideo(keyword: string): Promise<string | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(keyword)}&orientation=portrait&per_page=1&size=medium`,
      { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const files: PexelsVideoFile[] = data.videos?.[0]?.video_files ?? [];
    if (files.length === 0) return null;

    // Prefer a vertical file close to 1080x1920; Pexels doesn't guarantee exact dimensions.
    const mp4Files = files.filter((f) => f.file_type === "video/mp4" && f.height >= f.width);
    const pool = mp4Files.length > 0 ? mp4Files : files.filter((f) => f.file_type === "video/mp4");
    if (pool.length === 0) return null;

    const best = pool.reduce((a, b) => (Math.abs(a.height - 1920) < Math.abs(b.height - 1920) ? a : b));
    return best.link;
  } catch {
    return null;
  }
}

async function fetchPexelsImage(keyword: string): Promise<string | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&orientation=portrait&per_page=1`,
      { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.photos?.[0]?.src?.portrait ?? data.photos?.[0]?.src?.large ?? null;
  } catch {
    return null;
  }
}

export async function pickBrollScenes(keywords: string[]): Promise<BrollScene[]> {
  const scenes: BrollScene[] = [];
  const list = keywords.length > 0 ? keywords : ["idea", "focus", "growth"];

  for (let i = 0; i < list.length; i++) {
    const keyword = list[i];

    const videoUrl = await fetchPexelsVideo(keyword);
    if (videoUrl) {
      scenes.push({ type: "video", url: videoUrl, label: keyword });
      continue;
    }

    const imageUrl = await fetchPexelsImage(keyword);
    if (imageUrl) {
      scenes.push({ type: "image", url: imageUrl, label: keyword });
      continue;
    }

    const [from, to] = GRADIENT_PALETTES[i % GRADIENT_PALETTES.length];
    scenes.push({ type: "gradient", from, to, label: keyword });
  }

  return scenes;
}
