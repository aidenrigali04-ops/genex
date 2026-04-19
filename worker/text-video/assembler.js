import { execa } from "execa";
import {
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";

/**
 * Assemble B-roll clips + voiceover + captions into a final 1080x1920 MP4.
 * Expects assPath and intermediates under the same directory as outputPath.
 * @param {{ shots: Array<{ duration: number; localPath: string }>; voiceoverPath: string; assPath: string; outputPath: string; outputDuration: number }} opts
 */
export async function assembleVideo({
  shots,
  voiceoverPath,
  assPath,
  outputPath,
  outputDuration,
}) {
  const dir = path.dirname(outputPath);
  mkdirSync(dir, { recursive: true });

  const scaledPaths = new Array(shots.length);
  await Promise.all(
    shots.map(async (shot, i) => {
      const scaledPath = path.join(dir, `scaled_${i}.mp4`);
      scaledPaths[i] = scaledPath;
      await execa(
        "ffmpeg",
        [
          "-ss",
          "0",
          "-t",
          String(shot.duration),
          "-i",
          shot.localPath,
          "-vf",
          "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1",
          "-c:v",
          "libx264",
          "-crf",
          "22",
          "-preset",
          "ultrafast",
          "-an",
          "-y",
          scaledPath,
        ],
        { stdio: "pipe" },
      );
    }),
  );

  const concatListPath = path.join(dir, "concat.txt");
  const concatContent = scaledPaths.map((p) => `file '${p}'`).join("\n");
  writeFileSync(concatListPath, concatContent);

  const rawVideoPath = path.join(dir, "raw_video.mp4");
  await execa(
    "ffmpeg",
    ["-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy", "-y", rawVideoPath],
    { stdio: "inherit" },
  );

  const assBase = path.basename(assPath);
  const assInWorkdir = path.join(dir, assBase);
  if (path.resolve(assPath) !== path.resolve(assInWorkdir)) {
    writeFileSync(assInWorkdir, readFileSync(assPath));
  }

  const dur =
    typeof outputDuration === "number" &&
    Number.isFinite(outputDuration) &&
    outputDuration > 0
      ? outputDuration
      : shots.reduce((s, sh) => s + (Number(sh.duration) || 0), 0);

  await execa(
    "ffmpeg",
    [
      "-i",
      rawVideoPath,
      "-i",
      voiceoverPath,
      "-vf",
      `ass=${assBase}`,
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-preset",
      "medium",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-t",
      String(dur),
      "-y",
      outputPath,
    ],
    { cwd: dir, stdio: "inherit" },
  );

  for (const p of [...scaledPaths, rawVideoPath, concatListPath]) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}
