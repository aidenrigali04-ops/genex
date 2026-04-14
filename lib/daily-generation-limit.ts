/** Free-tier cap; must match `consume_one_daily_generation` in Supabase. */
export const DAILY_FREE_GENERATION_LIMIT = 5;

function utcDateString(isoOrTimestamp: string): string {
  const d = new Date(isoOrTimestamp);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * How many generations count toward today's limit for display,
 * using the same UTC calendar-day rule as the RPC.
 */
export function effectiveDailyGenerationsUsed(
  dailyGenerations: number | null | undefined,
  lastResetAt: string | null | undefined,
): number {
  if (lastResetAt == null || lastResetAt === "") return 0;
  const lastDay = utcDateString(lastResetAt);
  const today = utcDateString(new Date().toISOString());
  if (!lastDay || !today) return Math.max(0, Number(dailyGenerations) || 0);
  if (lastDay < today) return 0;
  return Math.max(0, Math.floor(Number(dailyGenerations) || 0));
}
