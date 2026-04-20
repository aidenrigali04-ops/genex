/** Product tiers: Stripe price IDs from env map here. */

export const BILLING_TRIAL_DAYS = 3;

export const PLAN_TIERS = ["basic", "creator", "team"] as const;
export type PaidPlanTier = (typeof PLAN_TIERS)[number];

export const MONTHLY_CREDITS_BY_TIER: Record<PaidPlanTier, number> = {
  basic: 100,
  creator: 200,
  team: 500,
};

export const TOPUP_PACKS = [
  { id: "10" as const, credits: 10, label: "10 credits", priceUsd: 5 },
  { id: "50" as const, credits: 50, label: "50 credits", priceUsd: 25 },
  { id: "100" as const, credits: 100, label: "100 credits", priceUsd: 50 },
] as const;

export type TopUpPackId = (typeof TOPUP_PACKS)[number]["id"];

export const PLAN_CHECKOUT_LABEL: Record<
  PaidPlanTier,
  { name: string; priceUsd: number; creditsLabel: string }
> = {
  basic: { name: "Basic", priceUsd: 17, creditsLabel: "100 credits / month" },
  creator: {
    name: "Creator",
    priceUsd: 30,
    creditsLabel: "200 credits / month",
  },
  team: { name: "Team", priceUsd: 65, creditsLabel: "500 credits / month" },
};

export function monthlyAllowanceForTier(
  tier: string | null | undefined,
): number {
  if (tier === "basic" || tier === "creator" || tier === "team") {
    return MONTHLY_CREDITS_BY_TIER[tier];
  }
  return 0;
}
