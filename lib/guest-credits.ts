import {
  GUEST_CREDITS_KEY,
  GUEST_LIFETIME_FREE_CREDITS,
  GUEST_RESET_DATE_KEY,
  isUnlimitedCreditsModeClient,
  UNLIMITED_CREDITS_SENTINEL,
} from "@/lib/credits-config";

/** Remaining guest credits (lifetime pool until sign-up). */
export function readGuestCreditsRemaining(): number {
  if (isUnlimitedCreditsModeClient()) return UNLIMITED_CREDITS_SENTINEL;
  if (typeof window === "undefined") return GUEST_LIFETIME_FREE_CREDITS;

  try {
    window.localStorage.removeItem(GUEST_RESET_DATE_KEY);
  } catch {
    /* ignore */
  }

  const raw = window.localStorage.getItem(GUEST_CREDITS_KEY);
  const n = raw == null ? NaN : Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) {
    window.localStorage.setItem(
      GUEST_CREDITS_KEY,
      String(GUEST_LIFETIME_FREE_CREDITS),
    );
    return GUEST_LIFETIME_FREE_CREDITS;
  }
  return Math.min(GUEST_LIFETIME_FREE_CREDITS, Math.floor(n));
}

export function decrementGuestCreditsBy(amount: number): void {
  if (isUnlimitedCreditsModeClient()) return;
  if (typeof window === "undefined") return;
  const n = Math.max(0, Math.floor(amount));
  if (n === 0) return;
  const remaining = readGuestCreditsRemaining();
  const next = Math.max(0, remaining - n);
  window.localStorage.setItem(GUEST_CREDITS_KEY, String(next));
}

export function decrementGuestCredit(): void {
  decrementGuestCreditsBy(1);
}
