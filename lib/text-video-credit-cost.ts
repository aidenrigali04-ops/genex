/** Credits debited per stock-from-script (`text_video_jobs`) job. Server + client. */
export const TEXT_VIDEO_CREDIT_COST_DEFAULT = 5;

export function getTextVideoCreditCost(): number {
  const a = Number.parseInt(process.env.TEXT_VIDEO_CREDIT_COST ?? "", 10);
  if (Number.isFinite(a) && a > 0) return a;
  const b = Number.parseInt(
    process.env.NEXT_PUBLIC_TEXT_VIDEO_CREDIT_COST ?? "",
    10,
  );
  if (Number.isFinite(b) && b > 0) return b;
  return TEXT_VIDEO_CREDIT_COST_DEFAULT;
}
