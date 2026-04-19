import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

/** Read at call time so dotenv in worker.js has already run (imports run before dotenv otherwise). */
function pexelsKey() {
  return process.env.PEXELS_API_KEY?.trim() ?? "";
}

/**
 * Search Pexels for a vertical (portrait) video matching keyword.
 * Returns { url, duration, width, height, isNativePortrait } of the best match.
 */
function pexelsHeaders() {
  return {
    Authorization: pexelsKey(),
    /** Pexels asks for a descriptive User-Agent. */
    "User-Agent": "GenEx-TextVideo/1.0 (https://github.com/aidenrigali04-ops/genex)",
  };
}

/** Title, slug URL, user name, and optional tags for semantic scoring. */
function pexelsVideoTextHaystack(video) {
  const bits = [String(video.url ?? ""), String(video.user?.name ?? "")];
  if (Array.isArray(video.tags)) {
    for (const t of video.tags) {
      if (typeof t === "string") bits.push(t);
      else if (t != null && typeof t.title === "string") bits.push(t.title);
    }
  }
  return bits.join(" ").toLowerCase();
}

function scoreVideo(video, targetDur, keyword) {
  const dur = Number(video.duration) || 0;

  const durationScore =
    dur >= targetDur ? 10 : dur >= targetDur * 0.7 ? 5 : -20;

  const files = video.video_files ?? [];
  const hasHD = files.some((f) => f.height >= 1080 && f.height > f.width);
  const has4K = files.some((f) => f.height >= 2160);
  const resScore = has4K ? 8 : hasHD ? 5 : 0;

  const popScore = Math.min(
    5,
    Math.floor((video.video_pictures?.length ?? 0) / 2),
  );

  const hay = pexelsVideoTextHaystack(video);
  const kwTokens = String(keyword ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const titleMatchCount = kwTokens.filter(
    (tok) => tok.length > 3 && hay.includes(tok),
  ).length;
  const semanticScore = Math.min(6, titleMatchCount * 2);

  const hasPerson = /person|people|man|woman|girl|boy|human|face|portrait/i.test(
    hay,
  );
  const personScore = hasPerson ? 4 : 0;

  const motionScore = dur > 4 && hasHD ? 3 : 0;

  return (
    durationScore +
    resScore +
    popScore +
    semanticScore +
    personScore +
    motionScore
  );
}

export async function fetchPexelsClip(keyword, targetDuration) {
  if (!pexelsKey()) {
    throw new Error(
      "Missing PEXELS_API_KEY. Add it to worker/.env or the repo root .env.local (see https://www.pexels.com/api/), or set it in your host env (e.g. Railway).",
    );
  }
  const encoded = encodeURIComponent(keyword);
  const td = Math.max(3, Math.round(targetDuration || 5));
  const url = `https://api.pexels.com/videos/search?query=${encoded}&orientation=portrait&size=medium&per_page=25`;

  const res = await fetch(url, { headers: pexelsHeaders() });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pexels API error: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  let videos = data.videos ?? [];

  if (!videos.length) {
    const fallback = await fetch(
      `https://api.pexels.com/videos/search?query=${encoded}&orientation=portrait&per_page=25`,
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

  if (videos.length < 3) {
    const coreKeyword = String(keyword ?? "")
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 2)
      .join(" ");

    if (coreKeyword && coreKeyword !== String(keyword ?? "").trim()) {
      try {
        const fb2 = await fetch(
          `https://api.pexels.com/videos/search?query=${encodeURIComponent(
            coreKeyword,
          )}&orientation=portrait&per_page=15`,
          { headers: pexelsHeaders() },
        );
        if (fb2.ok) {
          const fb2Data = await fb2.json();
          const fb2Videos = fb2Data.videos ?? [];
          if (fb2Videos.length > 0) {
            const existingIds = new Set(videos.map((v) => v.id));
            const newVideos = fb2Videos.filter((v) => !existingIds.has(v.id));
            videos = [...videos, ...newVideos];
          }
        }
      } catch {
        /* ignore secondary fallback */
      }
    }
  }

  videos = [...videos].sort(
    (a, b) => scoreVideo(b, td, keyword) - scoreVideo(a, td, keyword),
  );

  const video = videos[0];
  const files = video.video_files ?? [];

  const sorted = [...files].sort((a, b) => {
    const isPortraitA = a.height > a.width;
    const isPortraitB = b.height > b.width;
    const hdA = a.height >= 1080 ? 1 : 0;
    const hdB = b.height >= 1080 ? 1 : 0;

    const scoreA =
      (isPortraitA ? 4 : 0) + hdA * 2 + (a.height >= 1920 ? 1 : 0);
    const scoreB =
      (isPortraitB ? 4 : 0) + hdB * 2 + (b.height >= 1920 ? 1 : 0);
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
    isNativePortrait: file.height > file.width,
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
