import type { SupabaseClient } from "@supabase/supabase-js";

import { isBillingEntitled } from "@/lib/billing-entitlement";
import { isUnlimitedCreditsModeServer } from "@/lib/credits-config";
import { normalizeInternalReturnPath } from "@/lib/normalize-internal-return-path";

/** Safe internal path for post-checkout / post-login redirects. */
export function normalizeAuthReturnPath(path: string): string {
  const raw = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return normalizeInternalReturnPath(raw);
}

/**
 * Where to send the user after they have a valid session (sign-in, sign-up
 * with session, or OAuth callback). Non–billing-entitled accounts go to plan
 * onboarding first; `returnNext` is where they land after choosing a plan.
 */
export async function postAuthLandingPath(
  supabase: SupabaseClient,
  userId: string,
  returnNext: string,
): Promise<string> {
  const next = normalizeAuthReturnPath(returnNext);
  if (isUnlimitedCreditsModeServer()) return next;

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status, unlimited_credits")
    .eq("id", userId)
    .maybeSingle();

  const row = profile as {
    subscription_status?: string | null;
    unlimited_credits?: boolean | null;
  } | null;
  const profileUnlimited = Boolean(row?.unlimited_credits);

  if (!isBillingEntitled(row?.subscription_status, profileUnlimited)) {
    return `/onboarding/plan?next=${encodeURIComponent(next)}`;
  }

  return next;
}
