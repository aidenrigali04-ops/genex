/** @deprecated Use GUEST_LIFETIME_FREE_CREDITS; kept for a few UI fallbacks. */
export const FREE_DAILY_CREDITS = 5;

/** Lifetime free generations for logged-out visitors (localStorage). */
export const GUEST_LIFETIME_FREE_CREDITS = 5;

/** Display / guest logic when test mode is on (must match server sentinel order of magnitude). */
export const UNLIMITED_CREDITS_SENTINEL = 999_999;

export const GUEST_CREDITS_KEY = "genex_guest_credits";
/** @deprecated No longer used for reset logic; kept to clear stale keys in browser. */
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
