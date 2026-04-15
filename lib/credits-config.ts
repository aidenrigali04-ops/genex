/** Free generations per day (guest localStorage + logged-in profile.credits). */
export const FREE_DAILY_CREDITS = 3;

/** Display / guest logic when test mode is on (must match server sentinel order of magnitude). */
export const UNLIMITED_CREDITS_SENTINEL = 999_999;

export const GUEST_CREDITS_KEY = "genex_guest_credits";
export const GUEST_RESET_DATE_KEY = "genex_guest_reset_date";

function truthyEnv(v: string | undefined): boolean {
  const t = v?.trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes";
}

/** Server: skip Supabase credit RPC in /api/generate. */
export function isUnlimitedCreditsModeServer(): boolean {
  return truthyEnv(process.env.GENEX_UNLIMITED_CREDITS);
}

/** Client: skip guest credit checks / decrements (set NEXT_PUBLIC_GENEX_UNLIMITED_CREDITS=1). */
export function isUnlimitedCreditsModeClient(): boolean {
  return truthyEnv(process.env.NEXT_PUBLIC_GENEX_UNLIMITED_CREDITS);
}
