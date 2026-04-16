import {
  FREE_DAILY_CREDITS,
  GUEST_CREDITS_KEY,
  GUEST_RESET_DATE_KEY,
  isUnlimitedCreditsModeClient,
  UNLIMITED_CREDITS_SENTINEL,
} from "@/lib/credits-config";

function todayLocalDate(): string {
  return new Date().toDateString();
}

/** Remaining guest credits after applying calendar-day reset (browser local timezone). */
export function readGuestCreditsRemaining(): number {
  if (isUnlimitedCreditsModeClient()) return UNLIMITED_CREDITS_SENTINEL;
  if (typeof window === "undefined") return FREE_DAILY_CREDITS;
  const storedDate = window.localStorage.getItem(GUEST_RESET_DATE_KEY);
  const today = todayLocalDate();
  if (storedDate !== today) {
    window.localStorage.setItem(GUEST_RESET_DATE_KEY, today);
    window.localStorage.setItem(GUEST_CREDITS_KEY, String(FREE_DAILY_CREDITS));
    return FREE_DAILY_CREDITS;
  }
  const raw = window.localStorage.getItem(GUEST_CREDITS_KEY);
  const n = raw == null ? NaN : Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) {
    window.localStorage.setItem(GUEST_CREDITS_KEY, String(FREE_DAILY_CREDITS));
    return FREE_DAILY_CREDITS;
  }
  return n;
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
