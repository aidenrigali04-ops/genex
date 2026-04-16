/** Shared rules for user video inputs → Storage object keys under bucket `videos`. */

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const ALLOWED_VIDEO_EXT = new Set([".mp4", ".mov"]);

export function extFromFilename(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

/** Safe basename segment for `inputs/{userId}/{timestamp}-{segment}`. */
export function safeStorageFileSegment(originalName: string): string {
  const base = (originalName.split(/[/\\]/).pop() ?? "video.mp4").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
  return cleaned.length > 0 ? cleaned : "video.mp4";
}

export type BuiltInputPath = {
  /** Path inside bucket `videos` (no bucket prefix). */
  storagePath: string;
};

export function buildVideoInputStoragePath(
  userId: string,
  originalFileName: string,
): BuiltInputPath {
  const ext = extFromFilename(originalFileName) || ".mp4";
  const safeExt = ALLOWED_VIDEO_EXT.has(ext) ? ext : ".mp4";
  let fileSeg = safeStorageFileSegment(originalFileName);
  if (!/\.(mp4|mov)$/i.test(fileSeg)) {
    fileSeg = `${fileSeg.replace(/\.+$/, "")}${safeExt}`;
  }
  return {
    storagePath: `inputs/${userId}/${Date.now()}-${fileSeg}`,
  };
}

export function assertAllowedVideoUpload(
  fileName: string,
  byteSize: number,
): { ok: true } | { ok: false; message: string } {
  if (byteSize > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      message: `Video must be under ${MAX_VIDEO_BYTES / (1024 * 1024)} MB.`,
    };
  }
  const ext = extFromFilename(fileName);
  if (!ALLOWED_VIDEO_EXT.has(ext)) {
    return {
      ok: false,
      message: "Unsupported video format. Use MP4 or MOV.",
    };
  }
  return { ok: true };
}
