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
 */
export async function assembleVideo({ shots, voiceoverPath, assPath, outputPath }) {
  const dir = path.dirname(outputPath);
  mkdirSync(dir, { recursive: true });

  const scaledPaths = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const scaledPath = path.join(dir, `scaled_${i}.mp4`);
    scaledPaths.push(scaledPath);

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
        "fast",
        "-an",
        "-y",
        scaledPath,
      ],
      { stdio: "inherit" },
    );
  }

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
      "-shortest",
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
