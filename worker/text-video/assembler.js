import { execa } from "execa";
import {
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";

import { getAudioDuration } from "./ffprobe-duration.js";

const FFMPEG_TIMEOUT_MS = 900_000;

/**
 * If FFMPEG_HWACCEL=1 is set in Railway env, use h264_nvenc instead of libx264.
 * Falls back to libx264 when unset (default). If nvenc is unavailable on the host,
 * unset FFMPEG_HWACCEL or install a build with nvenc.
 */
const USE_HWACCEL = process.env.FFMPEG_HWACCEL === "1";
const VIDEO_CODEC = USE_HWACCEL ? "h264_nvenc" : "libx264";
const ENCODE_PRESET = USE_HWACCEL ? "p4" : "fast";
const ENCODE_CRF_FLAG = USE_HWACCEL ? "-cq" : "-crf";

/** Shared video encode flags for clip scale, concat, and final mux (CRF/CQ 18). */
function videoEncodeCore() {
  return [
    "-c:v",
    VIDEO_CODEC,
    ENCODE_CRF_FLAG,
    "18",
    "-preset",
    ENCODE_PRESET,
    "-pix_fmt",
    "yuv420p",
  ];
}

/**
 * @param {unknown} err
 */
function ffmpegErr(err) {
  const e = err instanceof Error ? err : new Error(String(err));
  const any = /** @type {{ stderr?: unknown; shortMessage?: string }} */ (e);
  const raw = any.stderr;
  const tail = String(raw ?? "")
    .trim()
    .slice(-1800);
  const head = any.shortMessage ?? e.message;
  return tail ? `${head}\n${tail}` : head;
}

/**
 * @param {string} vf
 * @param {{ duration: number; localPath: string }} shot
 * @param {number} dur
 * @param {number} fps
 * @param {string} scaledPath
 */
function scaleClipArgs(vf, shot, dur, fps, scaledPath) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    "0.5",
    "-i",
    shot.localPath,
    "-t",
    String(dur),
    "-vf",
    vf,
    ...videoEncodeCore(),
    "-r",
    String(fps),
    "-an",
    scaledPath,
  ];
}

/**
 * @param {{ duration: number; localPath: string; pexelsResult?: { isNativePortrait?: boolean } }} shot
 * @param {number} i
 * @param {string} dir
 */
async function scaleOneClip(shot, i, dir) {
  const scaledPath = path.join(dir, `scaled_${i}.mp4`);
  const dur = Number(shot.duration) || 5;
  const fps = 30;
  const totalFrames = Math.max(1, Math.round(dur * fps));
  const isNativePortrait = shot.pexelsResult?.isNativePortrait === true;
  const kenEnabled = process.env.TEXT_VIDEO_KEN_BURNS !== "0";

  const simpleVf =
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1";

  const kenVf = [
    "scale=2160:3840:force_original_aspect_ratio=increase",
    "crop=1080:1920",
    "setsar=1",
    `zoompan=z='min(zoom+0.0008\\,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`,
  ].join(",");

  const vf =
    kenEnabled && !isNativePortrait ? kenVf : simpleVf;

  try {
    await execa("ffmpeg", scaleClipArgs(vf, shot, dur, fps, scaledPath), {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: FFMPEG_TIMEOUT_MS,
    });
  } catch (err) {
    if (kenEnabled && !isNativePortrait && vf === kenVf) {
      await execa(
        "ffmpeg",
        scaleClipArgs(simpleVf, shot, dur, fps, scaledPath),
        {
          stdio: ["ignore", "ignore", "pipe"],
          timeout: FFMPEG_TIMEOUT_MS,
        },
      );
    } else {
      throw new Error(`ffmpeg scale clip ${i}: ${ffmpegErr(err)}`);
    }
  }

  return scaledPath;
}

/**
 * Scale clips with bounded parallelism to avoid memory spikes on small Railway plans.
 * @param {Array<{ duration: number; localPath: string; pexelsResult?: { isNativePortrait?: boolean } }>} shots
 * @param {string} dir
 */
async function scaleAllClips(shots, dir) {
  const rawConc = Number(process.env.FFMPEG_CONCURRENCY);
  const CONCURRENCY =
    Number.isFinite(rawConc) && rawConc > 0 ? Math.floor(rawConc) : 4;
  const results = new Array(shots.length);

  for (let i = 0; i < shots.length; i += CONCURRENCY) {
    const batch = shots.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((shot, batchIdx) => scaleOneClip(shot, i + batchIdx, dir)),
    );
    batchResults.forEach((r, batchIdx) => {
      results[i + batchIdx] = r;
    });
  }

  return results;
}

/**
 * Assemble B-roll clips + voiceover + captions into a final 1080x1920 MP4.
 * @param {{
 *   shots: Array<{ duration: number; localPath: string; pexelsResult?: { isNativePortrait?: boolean } }>;
 *   voiceoverPath: string;
 *   assPath: string;
 *   outputPath: string;
 *   voDuration: number;
 * }} opts
 */
export async function assembleVideo({
  shots,
  voiceoverPath,
  assPath,
  outputPath,
  voDuration: voDurationParam,
}) {
  const dir = path.dirname(outputPath);
  mkdirSync(dir, { recursive: true });

  const scaledPaths = await scaleAllClips(shots, dir);

  const concatListPath = path.join(dir, "concat.txt");
  const concatLines = scaledPaths.map((p) => {
    const normalized = path.resolve(p).replace(/\\/g, "/");
    return `file '${normalized}'`;
  });
  writeFileSync(concatListPath, `${concatLines.join("\n")}\n`);

  const rawVideoPath = path.join(dir, "raw_video.mp4");
  try {
    await execa(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatListPath,
        ...videoEncodeCore(),
        "-r",
        "30",
        "-an",
        rawVideoPath,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
        timeout: FFMPEG_TIMEOUT_MS,
      },
    );
  } catch (err) {
    throw new Error(`ffmpeg concat: ${ffmpegErr(err)}`);
  }

  const assBase = path.basename(assPath);
  const assInWorkdir = path.join(dir, assBase);
  if (path.resolve(assPath) !== path.resolve(assInWorkdir)) {
    writeFileSync(assInWorkdir, readFileSync(assPath));
  }

  let voDur =
    typeof voDurationParam === "number" &&
    Number.isFinite(voDurationParam) &&
    voDurationParam > 0
      ? voDurationParam
      : await getAudioDuration(voiceoverPath);

  try {
    await execa(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        rawVideoPath,
        "-i",
        voiceoverPath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-vf",
        `ass=${assBase}`,
        ...videoEncodeCore(),
        ...(USE_HWACCEL
          ? []
          : ["-profile:v", "high", "-level", "4.1"]),
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "44100",
        "-t",
        String(Number(voDur.toFixed(3))),
        outputPath,
      ],
      { cwd: dir, stdio: ["ignore", "ignore", "pipe"], timeout: FFMPEG_TIMEOUT_MS },
    );
  } catch (err) {
    throw new Error(`ffmpeg mux (subs+audio): ${ffmpegErr(err)}`);
  }

  for (const p of [...scaledPaths, rawVideoPath, concatListPath]) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}
