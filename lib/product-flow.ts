/**
 * GenEx product economics & pre-account flow (single narrative source for UX + server).
 *
 * Pre-account: `GUEST_LIFETIME_FREE_CREDITS` lifetime pool in localStorage; same pool
 * for Write Content and stock-from-script video when `GENEX_TEXT_VIDEO_GUEST_USER_ID`
 * is configured. Source-clip (`video_jobs`) still requires sign-in.
 *
 * Post-sign-up: `BILLING_TRIAL_DAYS`-day trial on Basic / Creator / Team (`PLAN_CHECKOUT_LABEL`),
 * then monthly credits (`MONTHLY_CREDITS_BY_TIER`). Top-ups: `TOPUP_PACKS`.
 */
export {
  BILLING_TRIAL_DAYS,
  MONTHLY_CREDITS_BY_TIER,
  PLAN_CHECKOUT_LABEL,
  PLAN_TIERS,
  TOPUP_PACKS,
  type PaidPlanTier,
  type TopUpPackId,
} from "@/lib/billing-plans";
export { GUEST_LIFETIME_FREE_CREDITS } from "@/lib/credits-config";
export {
  getTextVideoCreditCost,
  TEXT_VIDEO_CREDIT_COST_DEFAULT,
} from "@/lib/text-video-credit-cost";
