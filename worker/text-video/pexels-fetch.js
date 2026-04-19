import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const PEXELS_KEY = process.env.PEXELS_API_KEY;

/**
 * Search Pexels for a vertical (portrait) video matching keyword.
 * Returns { url, duration, width, height } of the best match.
 */
const pexelsHeaders = () => ({
  Authorization: PEXELS_KEY,
  /** Pexels asks for a descriptive User-Agent. */
  "User-Agent": "GenEx-TextVideo/1.0 (https://github.com/aidenrigali04-ops/genex)",
});

export async function fetchPexelsClip(keyword, targetDuration) {
  if (!PEXELS_KEY) {
    throw new Error("Missing PEXELS_API_KEY");
  }
  const encoded = encodeURIComponent(keyword);
  const td = Math.max(3, Math.round(targetDuration || 5));
  // Video /search only supports query, orientation, size, locale, page, per_page — not min/max_duration.
  const url = `https://api.pexels.com/videos/search?query=${encoded}&orientation=portrait&size=medium&per_page=15`;

  const res = await fetch(url, { headers: pexelsHeaders() });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pexels API error: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  let videos = data.videos ?? [];

  if (!videos.length) {
    const fallback = await fetch(
      `https://api.pexels.com/videos/search?query=${encoded}&orientation=portrait&per_page=8`,
      { headers: pexelsHeaders() },
    );
    if (!fallback.ok) {
      const body = await fallback.text().catch(() => "");
      throw new Error(`Pexels fallback error: ${fallback.status} ${body.slice(0, 200)}`);
    }
    const fb = await fallback.json();
    const fbVideos = fb.videos ?? [];
    if (!fbVideos.length) {
      throw new Error(`No Pexels results for: ${keyword}`);
    }
    videos = fbVideos;
  }

  // Prefer clips whose native duration is closest to our target (we trim in ffmpeg).
  videos = [...videos].sort((a, b) => {
    const da = Math.abs((Number(a.duration) || 0) - td);
    const db = Math.abs((Number(b.duration) || 0) - td);
    return da - db;
  });

  const video = videos[0];
  const files = video.video_files ?? [];

  const sorted = [...files].sort((a, b) => {
    const scoreA = (a.height >= 1080 ? 2 : 0) + (a.height > a.width ? 1 : 0);
    const scoreB = (b.height >= 1080 ? 2 : 0) + (b.height > b.width ? 1 : 0);
    return scoreB - scoreA;
  });

  const file = sorted[0];
  if (!file?.link) {
    throw new Error(`No downloadable file for: ${keyword}`);
  }

  return {
    url: file.link,
    duration: video.duration,
    width: file.width,
    height: file.height,
  };
}

/**
 * Download a video URL to a local file path.
 */
export async function downloadToFile(url, destPath) {
  const isPexels = /pexels\.com/i.test(url);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "GenEx-TextVideo/1.0",
      ...(isPexels ? { Referer: "https://www.pexels.com/" } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status}`);
  }
  if (!res.body) {
    throw new Error("Download failed: empty body");
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
}
