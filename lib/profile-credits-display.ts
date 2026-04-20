import { UNLIMITED_CREDITS_SENTINEL } from "@/lib/credits-config";
import { isBillingEntitled } from "@/lib/billing-entitlement";

export type ProfileCreditsRow = {
  credits?: number | null;
  last_reset_at?: string | null;
  unlimited_credits?: boolean | null;
  subscription_status?: string | null;
  plan_credits_remaining?: number | null;
  bonus_credits?: number | null;
};

/** Remaining spendable credits for display (no decrement). */
export function remainingCreditsForDisplay(row: ProfileCreditsRow | null): number {
  if (!row) return 0;
  if (row.unlimited_credits) return UNLIMITED_CREDITS_SENTINEL;
  if (
    isBillingEntitled(row.subscription_status, row.unlimited_credits ?? false)
  ) {
    const p = Math.max(0, Math.floor(Number(row.plan_credits_remaining ?? 0)));
    const b = Math.max(0, Math.floor(Number(row.bonus_credits ?? 0)));
    return p + b;
  }
  return 0;
}
