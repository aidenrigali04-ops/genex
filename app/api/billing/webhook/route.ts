import type Stripe from "stripe";

import {
  handleCheckoutSessionCompleted,
  handleInvoicePaid,
  handleSubscriptionUpdated,
} from "@/lib/billing-webhook-handlers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripe } from "@/lib/stripe-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !secret) {
    return new Response("Billing not configured", { status: 503 });
  }

  const body = await request.text();
  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid payload";
    return new Response(`Webhook signature: ${msg}`, { status: 400 });
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return new Response("Missing service role", { status: 500 });
  }

  const { error: dedupeErr } = await admin
    .from("stripe_webhook_events")
    .insert({ id: event.id });
  if (dedupeErr) {
    const dup =
      dedupeErr.code === "23505" ||
      String(dedupeErr.message).toLowerCase().includes("duplicate");
    if (dup) {
      return Response.json({ received: true, duplicate: true });
    }
    console.error("[billing/webhook] dedupe insert", dedupeErr);
    return new Response("Database error", { status: 500 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        await handleCheckoutSessionCompleted(
          admin,
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        await handleSubscriptionUpdated(
          admin,
          event.data.object as Stripe.Subscription,
        );
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.supabase_user_id;
        const customerId = typeof sub.customer === "string" ? sub.customer : null;
        let uid = userId as string | undefined;
        if (!uid && customerId) {
          const { data: prof } = await admin
            .from("profiles")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .maybeSingle();
          uid = (prof as { id?: string } | null)?.id;
        }
        if (uid) {
          await admin
            .from("profiles")
            .update({
              subscription_status: "canceled",
              stripe_subscription_id: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", uid);
        }
        break;
      }
      case "invoice.paid": {
        await handleInvoicePaid(admin, event.data.object as Stripe.Invoice);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("[billing/webhook] handler error", e);
    return new Response("Handler error", { status: 500 });
  }

  return Response.json({ received: true });
}
