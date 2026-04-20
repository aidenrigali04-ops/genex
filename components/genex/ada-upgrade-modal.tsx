"use client";

import type { JSX } from "react";
import { useState } from "react";
import Link from "next/link";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  PLAN_CHECKOUT_LABEL,
  TOPUP_PACKS,
  type TopUpPackId,
} from "@/lib/billing-plans";
import { GUEST_LIFETIME_FREE_CREDITS } from "@/lib/credits-config";
import { cn } from "@/lib/utils";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type UpgradeTrigger = "low_credits" | "no_credits" | "manual";

export type AdaUpgradeModalProps = {
  open: boolean;
  onClose: () => void;
  creditsRemaining: number;
  creditsUnlimited: boolean;
  trigger?: UpgradeTrigger;
  variant?: "default" | "adaKit";
  creditMeterDenom?: number;
  signedIn?: boolean;
};

const HEADER_COPY: Record<
  UpgradeTrigger,
  { headline: string; subhead: string }
> = {
  no_credits: {
    headline: "You're out of credits",
    subhead:
      "No credits were charged for your last request. Add a top-up or manage your plan.",
  },
  low_credits: {
    headline: "Running low",
    subhead: "You're almost out of monthly credits. Top up or upgrade your plan.",
  },
  manual: {
    headline: "Credits & plans",
    subhead: "Choose a subscription with a 3-day free trial or buy extra credits.",
  },
};

function creditMeterWidth(
  creditsRemaining: number,
  creditsUnlimited: boolean,
  denom: number,
): string {
  if (creditsUnlimited) return "100%";
  const d = Math.max(1, denom);
  return `${Math.min(100, (creditsRemaining / d) * 100)}%`;
}

export function AdaUpgradeModal({
  open,
  onClose,
  creditsRemaining,
  creditsUnlimited,
  trigger = "manual",
  variant = "default",
  creditMeterDenom = 100,
  signedIn = false,
}: AdaUpgradeModalProps): JSX.Element {
  const kit = variant === "adaKit";
  const copy = HEADER_COPY[trigger];
  const denom = Math.max(1, creditMeterDenom);
  const [topUpBusy, setTopUpBusy] = useState<TopUpPackId | null>(null);

  const meterHigh = !creditsUnlimited && creditsRemaining <= 2;
  const meterMid =
    !creditsUnlimited &&
    creditsRemaining > 2 &&
    creditsRemaining <= Math.max(5, Math.floor(denom * 0.05));

  const contentClass = kit
    ? "max-h-[90vh] overflow-y-auto border-white/14 bg-[linear-gradient(160deg,#1a0533_0%,#0d0020_100%)] text-white sm:max-w-lg"
    : "max-h-[90vh] overflow-y-auto border-ada-border bg-ada-card text-ada-primary sm:max-w-lg";

  const headlineClass = kit ? "text-white" : "text-ada-primary";
  const subClass = kit ? "text-white/60" : "text-ada-secondary";
  const labelClass = kit ? "text-white/60" : "text-ada-secondary";
  const valueClass = kit ? "text-white" : "text-ada-primary font-semibold";

  async function startTopUp(pack: TopUpPackId) {
    setTopUpBusy(pack);
    try {
      const res = await fetch("/api/billing/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok) {
        if (j.error === "subscription_required") {
          toast.message("Choose a plan first", {
            description: "Subscriptions include monthly credits and optional top-ups.",
          });
          return;
        }
        toast.error(j.error ?? "Checkout could not start.");
        return;
      }
      if (j.url) {
        window.open(j.url, "_self", "noopener,noreferrer");
      }
    } catch {
      toast.error("Network error.");
    } finally {
      setTopUpBusy(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton
        overlayClassName="bg-black/50 backdrop-blur-sm supports-backdrop-filter:backdrop-blur-sm"
        className={cn("gap-0 p-0 sm:max-w-lg", contentClass)}
      >
        <div className="p-6 pb-4">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className={cn("text-xl font-semibold", headlineClass)}>
              {copy.headline}
            </DialogTitle>
            <DialogDescription className={cn("text-sm leading-relaxed", subClass)}>
              {copy.subhead}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pb-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className={cn("text-xs", labelClass)}>Credits</span>
              <span className={cn("text-xs", valueClass)}>
                {creditsUnlimited ? "∞" : `${creditsRemaining} remaining`}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-ada-border">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700 ease-out",
                  meterHigh
                    ? "bg-[var(--ada-error)]"
                    : meterMid
                      ? "bg-[#F59E0B]"
                      : "bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF]",
                )}
                style={{
                  width: creditMeterWidth(
                    creditsRemaining,
                    creditsUnlimited,
                    denom,
                  ),
                }}
              />
            </div>
          </div>
        </div>

        <div className="space-y-4 px-6 pb-4">
          <p className={cn("text-xs font-medium uppercase tracking-wider", labelClass)}>
            Plans · 3-day free trial
          </p>
          <div className="grid gap-2">
            {(["basic", "creator", "team"] as const).map((tier) => {
              const row = PLAN_CHECKOUT_LABEL[tier];
              return (
                <div
                  key={tier}
                  className={cn(
                    "flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs",
                    kit ? "border-white/14 bg-white/[0.04]" : "border-ada-border bg-ada-card",
                  )}
                >
                  <div>
                    <p className={cn("font-semibold", headlineClass)}>{row.name}</p>
                    <p className={cn("text-[11px]", subClass)}>{row.creditsLabel}</p>
                  </div>
                  <span className={cn("font-semibold tabular-nums", valueClass)}>
                    ${row.priceUsd}/mo
                  </span>
                </div>
              );
            })}
          </div>
          <Link
            href="/onboarding/plan?next=%2F"
            className={cn(
              "flex w-full items-center justify-center rounded-full py-2.5 text-center text-sm font-semibold text-white no-underline",
              kit
                ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)]"
                : "bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF]",
            )}
            onClick={() => onClose()}
          >
            Choose plan & start trial
          </Link>
        </div>

        {signedIn ? (
          <div className="space-y-3 border-t border-white/10 px-6 py-4">
            <p className={cn("text-xs font-medium uppercase tracking-wider", labelClass)}>
              Extra credits (one-time)
            </p>
            <div className="grid gap-2">
              {TOPUP_PACKS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={topUpBusy != null}
                  onClick={() => void startTopUp(p.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs transition-opacity hover:opacity-95 disabled:opacity-50",
                    kit ? "border-white/14 bg-white/[0.04]" : "border-ada-border bg-ada-card",
                  )}
                >
                  <span className={cn("font-medium", headlineClass)}>{p.label}</span>
                  <span className="flex items-center gap-2">
                    <span className={cn("font-semibold tabular-nums", valueClass)}>
                      ${p.priceUsd}
                    </span>
                    {topUpBusy === p.id ? (
                      <Loader2 className="size-4 animate-spin text-white/70" aria-hidden />
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="px-6 pb-4">
            <p className={cn("text-xs", subClass)}>
              Guests get {GUEST_LIFETIME_FREE_CREDITS} free previews. Create an account
              to subscribe and unlock monthly credits.
            </p>
            <Link
              href="/auth/sign-up?next=%2F"
              className={cn(
                "mt-3 flex w-full items-center justify-center rounded-full py-2.5 text-center text-sm font-semibold text-white no-underline",
                kit
                  ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)]"
                  : "bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF]",
              )}
              onClick={() => onClose()}
            >
              Create account
            </Link>
          </div>
        )}

        <div
          className={cn(
            "grid grid-cols-2 gap-3 px-6 pb-6",
            signedIn ? "pt-2" : "",
          )}
        >
          <div
            className={cn(
              "rounded-2xl border p-4",
              kit ? "border-white/14 bg-white/[0.04]" : "border-ada-border bg-ada-card",
            )}
          >
            <p className={cn("text-sm font-semibold", headlineClass)}>Guest</p>
            <ul className="mt-3 space-y-2 text-[11px] leading-snug">
              <PlanRow ok kit={kit} text={`${GUEST_LIFETIME_FREE_CREDITS} free previews`} />
              <PlanRow ok kit={kit} text="Clip workspace" />
              <PlanRow ok={false} kit={kit} text="Monthly credits" />
              <PlanRow ok={false} kit={kit} text="Top-ups" />
            </ul>
          </div>
          <div
            className={cn(
              "relative rounded-2xl border p-4",
              kit
                ? "border-[color-mix(in_srgb,white_28%,transparent)] bg-white/[0.06]"
                : "border-[color-mix(in_srgb,var(--ada-accent)_40%,var(--ada-border))] bg-ada-accent-subtle",
            )}
          >
            <span className="absolute -top-2 right-2 rounded-full bg-ada-accent px-2 py-0.5 text-[9px] font-bold tracking-widest text-white uppercase">
              Pro
            </span>
            <p className={cn("text-sm font-semibold", headlineClass)}>Subscriber</p>
            <ul className="mt-3 space-y-2 text-[11px] leading-snug">
              <PlanRow ok kit={kit} text="100–500 credits / month" />
              <PlanRow ok kit={kit} text="3-day free trial" />
              <PlanRow ok kit={kit} text="Top-up packs" />
              <PlanRow ok kit={kit} text="Save history" />
              <PlanRow ok kit={kit} text="Voice profile" />
            </ul>
          </div>
        </div>

        <div
          className={cn(
            "flex flex-col items-center gap-3 border-t px-6 pt-4 pb-6",
            kit ? "border-white/14" : "border-ada-border",
          )}
        >
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "text-xs transition-colors",
              kit ? "text-white/45 hover:text-white/70" : "text-ada-disabled hover:text-ada-secondary",
            )}
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanRow({
  ok,
  text,
  kit,
}: {
  ok: boolean;
  text: string;
  kit: boolean;
}): JSX.Element {
  const Icon = ok ? Check : X;
  const iconClass = ok
    ? "text-ada-accent"
    : kit
      ? "text-white/35"
      : "text-ada-disabled";
  const textClass = kit
    ? ok
      ? "text-white/90"
      : "text-white/40"
    : ok
      ? "text-ada-primary"
      : "text-ada-disabled";
  return (
    <li className="flex items-start gap-2">
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", iconClass)} aria-hidden />
      <span className={textClass}>{text}</span>
    </li>
  );
}
