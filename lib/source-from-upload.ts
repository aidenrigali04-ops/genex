import OpenAI from "openai";

/** OpenAI Whisper / transcriptions limit (bytes). */
export const MAX_MEDIA_UPLOAD_BYTES = 25 * 1024 * 1024;

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
  "FLAC, M4A, MP3, MP4, MPEG, MPGA, OGA, OGG, WAV, or WebM";

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

function isWhisperSupportedFile(file: File, ext: string): boolean {
  if (WHISPER_EXTENSIONS.has(ext)) return true;
  const t = file.type.toLowerCase();
  if (!t) return false;
  return WHISPER_MIME_TYPES.has(t);
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
      `Unsupported file type for transcription. Use ${WHISPER_FORMATS_HUMAN}, or a text file (.txt, .md, .srt, .vtt, etc.). QuickTime (.mov) is not supported — export as MP4 or M4A.`,
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
  const upload = new File([await file.arrayBuffer()], safeName, {
    type: file.type || "application/octet-stream",
  });

  let transcription: OpenAI.Audio.Transcriptions.Transcription;
  try {
    transcription = await client.audio.transcriptions.create({
      file: upload,
      model: "whisper-1",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("Invalid file format") ||
      msg.toLowerCase().includes("unsupported")
    ) {
      throw new Error(
        `That file format is not supported for transcription. Use ${WHISPER_FORMATS_HUMAN}.`,
      );
    }
    throw e;
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
