import { z } from "zod";

import { BILLING_TRIAL_DAYS, type PaidPlanTier } from "@/lib/billing-plans";
import { billingConfigured, stripePriceIdForPlan } from "@/lib/billing-price-env";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe-server";

const bodySchema = z.object({
  plan: z.enum(["basic", "creator", "team"]),
});

function siteOrigin(request: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!billingConfigured()) {
    return Response.json(
      { error: "billing_not_configured" },
      { status: 503 },
    );
  }
  const stripe = getStripe();
  if (!stripe) {
    return Response.json(
      { error: "billing_not_configured" },
      { status: 503 },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const plan = parsed.data.plan as PaidPlanTier;
  const priceId = stripePriceIdForPlan(plan);
  if (!priceId) {
    return Response.json({ error: "missing_price_env" }, { status: 500 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: prof } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  const existingCustomer = (
    prof as { stripe_customer_id?: string | null } | null
  )?.stripe_customer_id;

  const origin = siteOrigin(request);
  const successUrl = `${origin}/?billing=success`;
  const cancelUrl = `${origin}/onboarding/plan?canceled=1`;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    ...(existingCustomer
      ? { customer: existingCustomer }
      : { customer_email: user.email ?? undefined }),
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: user.id,
    metadata: {
      supabase_user_id: user.id,
      plan_tier: plan,
    },
    subscription_data: {
      trial_period_days: BILLING_TRIAL_DAYS,
      metadata: {
        supabase_user_id: user.id,
        plan_tier: plan,
      },
    },
  });

  if (!session.url) {
    return Response.json({ error: "no_checkout_url" }, { status: 500 });
  }

  return Response.json({ url: session.url });
}
