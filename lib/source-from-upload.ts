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

const MEDIA_EXTENSIONS = new Set([
  ".flac",
  ".m4a",
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpga",
  ".mov",
  ".oga",
  ".ogg",
  ".wav",
  ".webm",
]);

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

function isProbablyMediaFile(file: File, ext: string): boolean {
  if (MEDIA_EXTENSIONS.has(ext)) return true;
  const t = file.type.toLowerCase();
  return t.startsWith("audio/") || t.startsWith("video/");
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

  if (!isProbablyMediaFile(file, ext)) {
    throw new Error(
      "Unsupported file type. Use video or audio (e.g. MP4, MOV, WebM, MP3, WAV) for transcription, or .txt / .md / .srt / .vtt for text.",
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

  const transcription = await client.audio.transcriptions.create({
    file: upload,
    model: "whisper-1",
  });

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
