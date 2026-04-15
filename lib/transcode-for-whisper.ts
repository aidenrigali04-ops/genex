import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

function stderrFromExecError(e: unknown): string {
  if (typeof e !== "object" || e === null) return "";
  if ("stderr" in e) {
    const s = (e as { stderr: Buffer | string }).stderr;
    return Buffer.isBuffer(s) ? s.toString("utf8") : String(s);
  }
  return "";
}

/**
 * Decodes arbitrary containers/codecs to MP3 for OpenAI Whisper (libmp3lame).
 * Uses temp files under `os.tmpdir()` (e.g. `/tmp` on Vercel).
 */
export async function transcodeToMp3(
  input: Buffer,
  inputSuffix: string,
): Promise<Buffer> {
  const bin = ffmpegPath ?? process.env.FFMPEG_BIN;
  if (!bin || typeof bin !== "string") {
    throw new Error(
      "FFmpeg is not available on this platform; export audio as MP3 or M4A and upload again.",
    );
  }

  const id = randomUUID();
  const suffix =
    inputSuffix && inputSuffix.startsWith(".") ? inputSuffix : ".bin";
  const inPath = join(tmpdir(), `genex-in-${id}${suffix}`);
  const outPath = join(tmpdir(), `genex-out-${id}.mp3`);

  await writeFile(inPath, input);
  try {
    await execFileAsync(
      bin,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inPath,
        "-vn",
        "-acodec",
        "libmp3lame",
        "-q:a",
        "4",
        outPath,
      ],
      { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
    );
    return await readFile(outPath);
  } catch (e: unknown) {
    const stderr = stderrFromExecError(e);
    const msg = e instanceof Error ? e.message : String(e);
    const detail = [stderr.trim(), msg].filter(Boolean).join(" — ").slice(0, 500);
    throw new Error(
      detail
        ? `FFmpeg could not read that media: ${detail}`
        : "FFmpeg could not convert that media to MP3.",
    );
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}
