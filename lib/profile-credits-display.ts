import { FREE_DAILY_CREDITS } from "@/lib/credits-config";

/** Remaining credits for display (no decrement). Uses UTC calendar day vs last_reset_at. */
export function remainingCreditsForDisplay(row: {
  credits: number | null;
  last_reset_at: string | null;
} | null): number {
  if (!row || row.last_reset_at == null) return FREE_DAILY_CREDITS;
  const last = new Date(row.last_reset_at).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (last < today) return FREE_DAILY_CREDITS;
  const c = row.credits;
  if (c == null || Number.isNaN(Number(c))) return FREE_DAILY_CREDITS;
  return Math.max(0, Math.floor(Number(c)));
}
