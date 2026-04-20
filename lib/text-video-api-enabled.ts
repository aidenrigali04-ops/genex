/** Mirrors worker `text-video-feature-flag.js`. When false, API refuses new text→video jobs. */
export function isTextVideoJobsApiEnabled(): boolean {
  const v = process.env.ENABLE_TEXT_VIDEO_JOBS;
  if (v == null || String(v).trim() === "") return true;
  const t = String(v).trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(t);
}
