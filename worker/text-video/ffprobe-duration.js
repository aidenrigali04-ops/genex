import { execa } from "execa";

/**
 * Audio / media duration in seconds (ffprobe format=duration).
 * @param {string} filePath
 * @returns {Promise<number>}
 */
export async function getAudioDuration(filePath) {
  const { stdout } = await execa("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const n = parseFloat(String(stdout).trim());
  return Number.isFinite(n) && n > 0 ? n : 30;
}
