import OpenAI from "openai";

import { MAX_MEDIA_UPLOAD_BYTES } from "@/lib/media-upload-limits";
import { transcodeToMp3 } from "@/lib/transcode-for-whisper";

const MAX_TEXT_CHARS = 120_000;

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".srt",
  ".vtt",
  ".json",
]);

/** Must match OpenAI Whisper `audio.transcriptions` supported inputs. */
const WHISPER_EXTENSIONS = new Set([
  ".flac",
  ".m4a",
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpga",
  ".oga",
  ".ogg",
  ".wav",
  ".webm",
]);

/** MIME types Whisper accepts when extension is missing or unreliable. */
const WHISPER_MIME_TYPES = new Set([
  "audio/flac",
  "audio/m4a",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/webm",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/ogg",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "application/ogg",
]);

const WHISPER_FORMATS_HUMAN =
  "FLAC, M4A, MP3, MP4, MPEG, MPGA, OGA, OGG, WAV, WebM, MOV, or M4V";

/** Apple / iOS “Files” — transcoded server-side to MP3 before Whisper. */
const APPLE_MOV_STYLE_EXTENSIONS = new Set([".mov", ".m4v"]);

function extFromFilename(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/^.*[/\\]/, "").slice(0, 200);
  return base.replace(/[^\w.\-()+ ]/g, "_") || "upload";
}

function isProbablyTextFile(file: File, ext: string): boolean {
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const t = file.type.toLowerCase();
  return (
    t === "text/plain" ||
    t === "text/markdown" ||
    t === "text/csv" ||
    t === "application/json" ||
    t.startsWith("text/")
  );
}

function isAppleMovStyleContainer(file: File, ext: string): boolean {
  if (APPLE_MOV_STYLE_EXTENSIONS.has(ext)) return true;
  const t = file.type.toLowerCase();
  if (t !== "video/quicktime" && t !== "video/x-m4v") return false;
  if (TEXT_EXTENSIONS.has(ext)) return false;
  if (WHISPER_EXTENSIONS.has(ext)) return false;
  return true;
}

function isWhisperSupportedFile(file: File, ext: string): boolean {
  if (WHISPER_EXTENSIONS.has(ext)) return true;
  const t = file.type.toLowerCase();
  if (t && WHISPER_MIME_TYPES.has(t)) return true;
  return isAppleMovStyleContainer(file, ext);
}

function stripExtension(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i > 0 ? filename.slice(0, i) : filename;
}

/** File extension hint for FFmpeg’s demuxer (`-i` input path). */
function ffmpegInputSuffix(ext: string, mimeType: string): string {
  if (APPLE_MOV_STYLE_EXTENSIONS.has(ext)) return ext;
  const t = mimeType.toLowerCase();
  if (
    (t === "video/quicktime" || t === "video/x-m4v") &&
    !WHISPER_EXTENSIONS.has(ext)
  ) {
    return ".mov";
  }
  if (ext) return ext;
  return ".mp4";
}

function isWhisperFormatOrCodecError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg.includes("invalid file format") ||
    msg.includes("unsupported") ||
    msg.includes("codec") ||
    msg.includes("could not find codec")
  );
}

/**
 * Reads plain-text-ish files as UTF-8, or transcribes audio/video via Whisper.
 */
export async function sourceFromUpload(file: File): Promise<{
  sourceText: string;
  storedInputUrl: string;
}> {
  const safeName = sanitizeFilename(file.name);
  const storedInputUrl = `file:${safeName}`;
  const ext = extFromFilename(file.name);

  if (isProbablyTextFile(file, ext)) {
    const raw = await file.text();
    const trimmed = raw.replace(/^\uFEFF/, "").trim();
    if (!trimmed) {
      throw new Error("That file is empty or has no readable text.");
    }
    const sourceText =
      trimmed.length > MAX_TEXT_CHARS
        ? `${trimmed.slice(0, MAX_TEXT_CHARS)}\n\n[Truncated to ${MAX_TEXT_CHARS} characters for generation.]`
        : trimmed;
    return { sourceText, storedInputUrl };
  }

  if (!isWhisperSupportedFile(file, ext)) {
    throw new Error(
      `Unsupported file type for transcription. Use ${WHISPER_FORMATS_HUMAN}, or a text file (.txt, .md, .srt, .vtt, etc.).`,
    );
  }

  if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
    throw new Error(
      `File is too large for transcription (${Math.round(file.size / (1024 * 1024))} MB). Max is ${MAX_MEDIA_UPLOAD_BYTES / (1024 * 1024)} MB.`,
    );
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("Missing OPENAI_API_KEY for transcription.");
  }

  const client = new OpenAI({ apiKey: key });
  const buf = new Uint8Array(await file.arrayBuffer());
  const bufNode = Buffer.from(buf);

  let convertedWithFfmpeg = false;
  let upload: File;

  if (isAppleMovStyleContainer(file, ext)) {
    const mp3 = await transcodeToMp3(bufNode, ffmpegInputSuffix(ext, file.type));
    convertedWithFfmpeg = true;
    upload = new File([new Uint8Array(mp3)], `${stripExtension(safeName) || "audio"}.mp3`, {
      type: "audio/mpeg",
    });
  } else {
    upload = new File([buf], safeName, {
      type: file.type || "application/octet-stream",
    });
  }

  let transcription: OpenAI.Audio.Transcriptions.Transcription;
  try {
    transcription = await client.audio.transcriptions.create({
      file: upload,
      model: "whisper-1",
    });
  } catch (e: unknown) {
    if (!isWhisperFormatOrCodecError(e)) throw e;
    if (convertedWithFfmpeg) {
      throw new Error(
        "That file could not be transcribed after conversion. Try a shorter clip, or export audio as MP3 or M4A and upload again.",
      );
    }
    try {
      const mp3 = await transcodeToMp3(
        bufNode,
        ffmpegInputSuffix(ext, file.type),
      );
      convertedWithFfmpeg = true;
      transcription = await client.audio.transcriptions.create({
        file: new File([new Uint8Array(mp3)], "audio.mp3", { type: "audio/mpeg" }),
        model: "whisper-1",
      });
    } catch (convErr: unknown) {
      const convMsg =
        convErr instanceof Error ? convErr.message : String(convErr);
      throw new Error(
        `That file uses a video or audio codec Whisper cannot read directly. We tried converting it with FFmpeg but that failed (${convMsg.slice(0, 280)}). Export as MP3 or AAC in M4A/MP4 and try again.`,
      );
    }
  }

  const text = transcription.text?.trim() ?? "";
  if (!text) {
    throw new Error(
      "Transcription returned no text. Try a clearer clip or a text file instead.",
    );
  }

  const sourceText =
    text.length > MAX_TEXT_CHARS
      ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[Truncated to ${MAX_TEXT_CHARS} characters for generation.]`
      : text;

  return { sourceText, storedInputUrl };
}
