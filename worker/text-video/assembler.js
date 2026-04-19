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
    "-c:v",
    "libx264",
    "-crf",
    "23",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
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

  const scaledPaths = new Array(shots.length);
  await Promise.all(
    shots.map(async (shot, i) => {
      scaledPaths[i] = await scaleOneClip(shot, i, dir);
    }),
  );

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
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
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
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "medium",
        "-profile:v",
        "high",
        "-level",
        "4.1",
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
