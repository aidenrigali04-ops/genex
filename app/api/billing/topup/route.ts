import { z } from "zod";

import type { TopUpPackId } from "@/lib/billing-plans";
import { billingConfigured, stripePriceIdForTopUp } from "@/lib/billing-price-env";
import { isBillingEntitled } from "@/lib/billing-entitlement";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe-server";

const bodySchema = z.object({
  pack: z.enum(["10", "50", "100"]),
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

  const pack = parsed.data.pack as TopUpPackId;
  const priceId = stripePriceIdForTopUp(pack);
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

  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("subscription_status, unlimited_credits, stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profErr) {
    return Response.json({ error: "profile_read_failed" }, { status: 500 });
  }
  const row = prof as {
    subscription_status?: string | null;
    unlimited_credits?: boolean | null;
    stripe_customer_id?: string | null;
  } | null;
  if (
    !isBillingEntitled(
      row?.subscription_status,
      Boolean(row?.unlimited_credits),
    )
  ) {
    return Response.json(
      { error: "subscription_required" },
      { status: 403 },
    );
  }

  const existingCustomer = row?.stripe_customer_id;
  const origin = siteOrigin(request);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    ...(existingCustomer
      ? { customer: existingCustomer }
      : { customer_email: user.email ?? undefined }),
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/?billing=topup_success`,
    cancel_url: `${origin}/?billing=topup_canceled=1`,
    client_reference_id: user.id,
    metadata: {
      supabase_user_id: user.id,
      kind: "topup",
      pack,
    },
  });

  if (!session.url) {
    return Response.json({ error: "no_checkout_url" }, { status: 500 });
  }

  return Response.json({ url: session.url });
}
