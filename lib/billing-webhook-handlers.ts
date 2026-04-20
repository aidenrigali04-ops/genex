import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { monthlyAllowanceForTier, type PaidPlanTier } from "@/lib/billing-plans";
import { getStripe } from "@/lib/stripe-server";

async function patchProfile(
  admin: SupabaseClient,
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin
    .from("profiles")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

function tierFromMetadata(
  meta: Stripe.Metadata | null | undefined,
): PaidPlanTier | null {
  const t = meta?.plan_tier ?? meta?.planTier;
  if (t === "basic" || t === "creator" || t === "team") return t;
  return null;
}

/** Apply subscription state + refill monthly credits (trial start or new sub). */
export async function syncSubscriptionToProfile(
  admin: SupabaseClient,
  params: {
    userId: string;
    customerId: string;
    subscriptionId: string;
    status: Stripe.Subscription.Status;
    currentPeriodEnd: number;
    planTier: PaidPlanTier;
  },
): Promise<void> {
  const { data: existing } = await admin
    .from("profiles")
    .select("bonus_credits")
    .eq("id", params.userId)
    .maybeSingle();
  const bonus = Math.max(
    0,
    Number((existing as { bonus_credits?: number } | null)?.bonus_credits ?? 0),
  );
  const allowance = monthlyAllowanceForTier(params.planTier);
  const periodEndIso = new Date(params.currentPeriodEnd * 1000).toISOString();
  await patchProfile(admin, params.userId, {
    stripe_customer_id: params.customerId,
    stripe_subscription_id: params.subscriptionId,
    subscription_status: params.status,
    current_period_end: periodEndIso,
    plan_tier: params.planTier,
    monthly_credit_allowance: allowance,
    plan_credits_remaining: allowance,
    bonus_credits: bonus,
    credits: allowance + bonus,
  });
}

export async function handleCheckoutSessionCompleted(
  admin: SupabaseClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const userId = session.metadata?.supabase_user_id;
  if (!userId) return;

  if (session.mode === "subscription") {
    const stripe = getStripe();
    if (!stripe) return;
    const subId = session.subscription;
    if (typeof subId !== "string") return;
    const sub = await stripe.subscriptions.retrieve(subId);
    const customerId =
      typeof session.customer === "string"
        ? session.customer
        : (sub.customer as string);
    const tier =
      tierFromMetadata(session.metadata) ??
      tierFromMetadata(sub.metadata) ??
      "basic";
    await syncSubscriptionToProfile(admin, {
      userId,
      customerId,
      subscriptionId: sub.id,
      status: sub.status,
      currentPeriodEnd: sub.current_period_end,
      planTier: tier,
    });
    return;
  }

  if (session.mode === "payment") {
    if (session.metadata?.kind !== "topup") return;
    const pack = session.metadata?.pack;
    const add =
      pack === "100" ? 100 : pack === "50" ? 50 : pack === "10" ? 10 : 0;
    if (add < 1) return;

    const { data: row, error: readErr } = await admin
      .from("profiles")
      .select("bonus_credits, plan_credits_remaining")
      .eq("id", userId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const bonus = Math.max(
      0,
      Number((row as { bonus_credits?: number })?.bonus_credits ?? 0),
    );
    const planRem = Math.max(
      0,
      Number((row as { plan_credits_remaining?: number })?.plan_credits_remaining ?? 0),
    );
    const nextBonus = bonus + add;
    await patchProfile(admin, userId, {
      bonus_credits: nextBonus,
      credits: planRem + nextBonus,
    });
  }
}

export async function handleSubscriptionUpdated(
  admin: SupabaseClient,
  sub: Stripe.Subscription,
): Promise<void> {
  let userId = sub.metadata?.supabase_user_id as string | undefined;
  if (!userId && typeof sub.customer === "string") {
    const { data: prof } = await admin
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", sub.customer)
      .maybeSingle();
    userId = (prof as { id?: string } | null)?.id;
  }
  if (!userId) return;

  const tier = tierFromMetadata(sub.metadata) ?? ("basic" as PaidPlanTier);
  const customerId = typeof sub.customer === "string" ? sub.customer : "";
  await patchProfile(admin, userId, {
    stripe_customer_id: customerId || undefined,
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    plan_tier: tier,
    monthly_credit_allowance: monthlyAllowanceForTier(tier),
  });
}

/** Refill monthly pool after a paid renewal invoice. */
export async function handleInvoicePaid(
  admin: SupabaseClient,
  invoice: Stripe.Invoice,
): Promise<void> {
  if (!invoice.subscription || typeof invoice.subscription !== "string") {
    return;
  }
  if (invoice.amount_paid === 0) {
    return;
  }
  const stripe = getStripe();
  if (!stripe) return;
  const sub = await stripe.subscriptions.retrieve(invoice.subscription);
  let userId = sub.metadata?.supabase_user_id as string | undefined;
  if (!userId && typeof sub.customer === "string") {
    const { data: prof } = await admin
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", sub.customer)
      .maybeSingle();
    userId = (prof as { id?: string } | null)?.id;
  }
  if (!userId) return;

  const tier = tierFromMetadata(sub.metadata) ?? ("basic" as PaidPlanTier);
  const allowance = monthlyAllowanceForTier(tier);
  const { data: bonusRow } = await admin
    .from("profiles")
    .select("bonus_credits")
    .eq("id", userId)
    .maybeSingle();
  const bonus = Math.max(
    0,
    Number((bonusRow as { bonus_credits?: number } | null)?.bonus_credits ?? 0),
  );
  await patchProfile(admin, userId, {
    plan_credits_remaining: allowance,
    monthly_credit_allowance: allowance,
    plan_tier: tier,
    credits: allowance + bonus,
  });
}
