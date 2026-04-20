import type { PaidPlanTier, TopUpPackId } from "@/lib/billing-plans";

const planKeys: Record<PaidPlanTier, string> = {
  basic: "STRIPE_PRICE_BASIC_MONTHLY",
  creator: "STRIPE_PRICE_CREATOR_MONTHLY",
  team: "STRIPE_PRICE_TEAM_MONTHLY",
};

const topupKeys: Record<TopUpPackId, string> = {
  "10": "STRIPE_PRICE_TOPUP_10",
  "50": "STRIPE_PRICE_TOPUP_50",
  "100": "STRIPE_PRICE_TOPUP_100",
};

export function stripePriceIdForPlan(tier: PaidPlanTier): string | null {
  const v = process.env[planKeys[tier]]?.trim();
  return v && v.length > 0 ? v : null;
}

export function stripePriceIdForTopUp(pack: TopUpPackId): string | null {
  const v = process.env[topupKeys[pack]]?.trim();
  return v && v.length > 0 ? v : null;
}

export function billingConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY?.trim() &&
      process.env.STRIPE_WEBHOOK_SECRET?.trim() &&
      stripePriceIdForPlan("basic") &&
      stripePriceIdForPlan("creator") &&
      stripePriceIdForPlan("team"),
  );
}
