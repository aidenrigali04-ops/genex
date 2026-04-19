"use client";

import type { JSX } from "react";
import { Check, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FREE_DAILY_CREDITS } from "@/lib/credits-config";
import { cn } from "@/lib/utils";

export type UpgradeTrigger = "low_credits" | "no_credits" | "manual";

export type AdaUpgradeModalProps = {
  open: boolean;
  onClose: () => void;
  creditsRemaining: number;
  creditsUnlimited: boolean;
  trigger?: UpgradeTrigger;
  variant?: "default" | "adaKit";
};

const HEADER_COPY: Record<
  UpgradeTrigger,
  { headline: string; subhead: string }
> = {
  no_credits: {
    headline: "You're out of credits",
    subhead:
      "No credits were charged for your last request. Upgrade to keep creating.",
  },
  low_credits: {
    headline: "Running low",
    subhead:
      "You're almost out of daily credits. Upgrade to remove the limit.",
  },
  manual: {
    headline: "Unlock unlimited videos",
    subhead:
      "Remove credit limits and create as many clips as you need.",
  },
};

function creditMeterWidth(
  creditsRemaining: number,
  creditsUnlimited: boolean,
): string {
  if (creditsUnlimited) return "100%";
  const denom = Math.max(1, FREE_DAILY_CREDITS);
  return `${Math.min(100, (creditsRemaining / denom) * 100)}%`;
}

export function AdaUpgradeModal({
  open,
  onClose,
  creditsRemaining,
  creditsUnlimited,
  trigger = "manual",
  variant = "default",
}: AdaUpgradeModalProps): JSX.Element {
  const kit = variant === "adaKit";
  const copy = HEADER_COPY[trigger];
  const meterHigh =
    !creditsUnlimited && creditsRemaining <= 2;
  const meterMid =
    !creditsUnlimited &&
    creditsRemaining > 2 &&
    creditsRemaining <= 5;

  const contentClass = kit
    ? "max-h-[90vh] overflow-y-auto border-white/14 bg-[linear-gradient(160deg,#1a0533_0%,#0d0020_100%)] text-white sm:max-w-lg"
    : "max-h-[90vh] overflow-y-auto border-ada-border bg-ada-card text-ada-primary sm:max-w-lg";

  const headlineClass = kit ? "text-white" : "text-ada-primary";
  const subClass = kit ? "text-white/60" : "text-ada-secondary";
  const labelClass = kit ? "text-white/60" : "text-ada-secondary";
  const valueClass = kit ? "text-white" : "text-ada-primary font-semibold";

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
              <span className={cn("text-xs", labelClass)}>Daily credits</span>
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
                style={{ width: creditMeterWidth(creditsRemaining, creditsUnlimited) }}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 px-6 pb-6">
          <div
            className={cn(
              "rounded-2xl border p-4",
              kit ? "border-white/14 bg-white/[0.04]" : "border-ada-border bg-ada-card",
            )}
          >
            <p className={cn("text-sm font-semibold", headlineClass)}>Free</p>
            <ul className="mt-3 space-y-2 text-[11px] leading-snug">
              <PlanRow ok kit={kit} text={`${FREE_DAILY_CREDITS} credits/day`} />
              <PlanRow ok kit={kit} text="Clip packages" />
              <PlanRow ok kit={kit} text="1 video/day" />
              <PlanRow ok={false} kit={kit} text="Unlimited videos" />
              <PlanRow ok={false} kit={kit} text="Priority queue" />
              <PlanRow ok={false} kit={kit} text="HD export" />
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
              Popular
            </span>
            <p className={cn("text-sm font-semibold", headlineClass)}>Pro</p>
            <ul className="mt-3 space-y-2 text-[11px] leading-snug">
              <PlanRow ok kit={kit} text="Unlimited videos" />
              <PlanRow ok kit={kit} text="Unlimited credits" />
              <PlanRow ok kit={kit} text="Priority queue" />
              <PlanRow ok kit={kit} text="HD export (coming)" />
              <PlanRow ok kit={kit} text="Voice Profile AI" />
              <PlanRow ok kit={kit} text="Generation history" />
            </ul>
          </div>
        </div>

        <div
          className={cn(
            "flex flex-col items-center gap-3 border-t px-6 pt-4 pb-6",
            kit ? "border-white/14" : "border-ada-border",
          )}
        >
          <a
            href="https://stripe.com"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full rounded-full bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF] px-6 py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
            aria-label="Upgrade to GenEx Pro"
          >
            Upgrade to Pro
          </a>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "text-xs transition-colors",
              kit ? "text-white/45 hover:text-white/70" : "text-ada-disabled hover:text-ada-secondary",
            )}
          >
            Maybe later
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
