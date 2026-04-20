"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { signOut } from "@/app/auth/actions";

import {
  BILLING_TRIAL_DAYS,
  PLAN_CHECKOUT_LABEL,
  type PaidPlanTier,
} from "@/lib/product-flow";
import { AdaFigmaAmbientBackground } from "@/components/genex/ada-figma-dashboard";
import { cn } from "@/lib/utils";

const TIERS: PaidPlanTier[] = ["basic", "creator", "team"];

type Props = {
  canceled: boolean;
};

export function PlanOnboardingClient({ canceled }: Props) {
  const [busy, setBusy] = useState<PaidPlanTier | null>(null);

  async function startCheckout(tier: PaidPlanTier) {
    setBusy(tier);
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: tier }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok) {
        toast.error(
          j.error === "billing_not_configured"
            ? "Billing is not configured on this server."
            : (j.error ?? "Could not start checkout."),
        );
        return;
      }
      if (j.url) {
        window.open(j.url, "_self", "noopener,noreferrer");
      }
    } catch {
      toast.error("Network error.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-[#0A050F] text-white">
      <AdaFigmaAmbientBackground />
      <div className="relative z-[1] mx-auto flex min-h-dvh max-w-5xl flex-col gap-8 px-5 py-12 sm:px-10">
        <div className="text-center">
          <p className="font-[family-name:var(--font-instrument-serif)] text-3xl leading-tight sm:text-4xl">
            Choose your plan
          </p>
          <p className="mt-2 font-[family-name:var(--font-instrument-sans)] text-sm text-white/64">
            Every plan includes a {BILLING_TRIAL_DAYS}-day free trial. Cancel anytime
            before you&apos;re charged.
          </p>
          {canceled ? (
            <p className="mt-3 text-sm text-amber-200/90">
              Checkout was canceled. Pick a plan when you&apos;re ready.
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {TIERS.map((tier) => {
            const row = PLAN_CHECKOUT_LABEL[tier];
            const loading = busy === tier;
            return (
              <div
                key={tier}
                className={cn(
                  "flex flex-col rounded-2xl border border-white/14 bg-white/[0.06] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-sm",
                  tier === "creator" && "ring-1 ring-[#D31CD7]/50",
                )}
              >
                <p className="font-[family-name:var(--font-instrument-serif)] text-2xl text-white">
                  {row.name}
                </p>
                <p className="mt-1 font-[family-name:var(--font-instrument-sans)] text-sm text-white/64">
                  {row.creditsLabel}
                </p>
                <p className="mt-4 font-[family-name:var(--font-instrument-sans)] text-3xl font-semibold tabular-nums text-white">
                  ${row.priceUsd}
                  <span className="text-base font-normal text-white/50">/mo</span>
                </p>
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() => void startCheckout(tier)}
                  className={cn(
                    "mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-medium text-white transition-opacity disabled:opacity-50",
                    "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)]",
                  )}
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : null}
                  Start {BILLING_TRIAL_DAYS}-day trial
                </button>
              </div>
            );
          })}
        </div>

        <p className="text-center font-[family-name:var(--font-instrument-sans)] text-xs text-white/45">
          After the trial, your card is charged monthly. Top-ups: 10 credits ($5),
          50 ($25), 100 ($50).
        </p>

        <div className="flex flex-wrap justify-center gap-4 text-sm">
          <form action={signOut}>
            <button
              type="submit"
              className="text-white/60 underline-offset-2 hover:text-white/90 hover:underline"
            >
              Sign out & try as guest
            </button>
          </form>
          <a
            href="/auth/login?next=%2Fonboarding%2Fplan"
            className="text-white/60 underline-offset-2 hover:text-white/90 hover:underline"
          >
            Switch account
          </a>
        </div>
      </div>
    </div>
  );
}
