/**
 * Optional kill-switch for the text→video (`text_video_jobs`) poller.
 * Source clipping (`video_jobs`) is unaffected.
 * Default: enabled (unset or empty). Set ENABLE_TEXT_VIDEO_JOBS=0 to disable.
 */
export function isTextVideoJobsEnabled() {
  const v = process.env.ENABLE_TEXT_VIDEO_JOBS;
  if (v == null || String(v).trim() === "") return true;
  const t = String(v).trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(t);
}
