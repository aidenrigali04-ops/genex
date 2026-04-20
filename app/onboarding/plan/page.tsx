import { redirect } from "next/navigation";

import { isBillingEntitled } from "@/lib/billing-entitlement";
import { isUnlimitedCreditsModeServer } from "@/lib/credits-config";
import { normalizeInternalReturnPath } from "@/lib/normalize-internal-return-path";
import { createClient } from "@/lib/supabase/server";

import { PlanOnboardingClient } from "./plan-onboarding-client";

type SearchParams = Promise<{ next?: string; canceled?: string }>;

export default async function OnboardingPlanPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const q = await searchParams;
  const nextRaw = typeof q.next === "string" ? q.next : "/";
  const nextPath = normalizeInternalReturnPath(
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/",
  );

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const back = `/onboarding/plan?next=${encodeURIComponent(nextPath)}`;
    redirect(`/auth/sign-up?next=${encodeURIComponent(back)}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status, unlimited_credits")
    .eq("id", user.id)
    .maybeSingle();

  const row = profile as {
    subscription_status?: string | null;
    unlimited_credits?: boolean | null;
  } | null;
  const profileUnlimited = Boolean(row?.unlimited_credits);

  if (
    isUnlimitedCreditsModeServer() ||
    profileUnlimited ||
    isBillingEntitled(row?.subscription_status, profileUnlimited)
  ) {
    redirect(nextPath);
  }

  return <PlanOnboardingClient canceled={q.canceled === "1"} />;
}
