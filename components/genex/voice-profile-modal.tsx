"use client";

import type { JSX, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type VoiceProfileData = {
  niche: string | null;
  tone_preference: string | null;
  hook_style: string | null;
};

export type VoiceProfileModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (profile: VoiceProfileData) => void;
  variant?: "default" | "adaKit";
};

const NICHE_PRESETS = [
  "Fitness & Health",
  "Finance & Money",
  "Beauty & Fashion",
  "Tech & AI",
];

const TONE_PRESETS = [
  "Conversational",
  "Authoritative",
  "Hype & Energy",
  "Calm & Trusted",
];

const HOOK_PRESETS = [
  "Bold Statement",
  "Question Hook",
  "Story Open",
  "Controversy",
];

type ChipRowProps = {
  presets: string[];
  value: string;
  onSelect: (v: string) => void;
  kit: boolean;
};

function ChipRow({ presets, value, onSelect, kit }: ChipRowProps): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5" role="group">
      {presets.map((preset) => {
        const active = value.trim().toLowerCase() === preset.toLowerCase();
        return (
          <button
            key={preset}
            type="button"
            onClick={() => onSelect(active ? "" : preset)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
              kit
                ? active
                  ? "border-white/30 bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] text-white"
                  : "border-white/14 bg-white/6 text-white/60 hover:border-white/25 hover:text-white/80"
                : active
                  ? "border-[color-mix(in_srgb,var(--ada-accent)_60%,transparent)] bg-ada-accent-subtle text-ada-accent-hover"
                  : "border-ada-border bg-ada-app text-ada-secondary hover:border-ada-border-active hover:text-ada-primary",
            )}
            aria-pressed={active}
          >
            {preset}
          </button>
        );
      })}
    </div>
  );
}

type FieldProps = {
  label: string;
  sublabel: string;
  presets: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  kit: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
};

function ProfileField({
  label,
  sublabel,
  presets,
  value,
  onChange,
  placeholder,
  kit,
  inputRef,
}: FieldProps): JSX.Element {
  return (
    <div className="space-y-2">
      <div>
        <label
          className={cn(
            "text-sm font-semibold",
            kit ? "text-white" : "text-ada-primary",
          )}
        >
          {label}
        </label>
        <p
          className={cn(
            "mt-0.5 text-[11px]",
            kit ? "text-white/40" : "text-ada-disabled",
          )}
        >
          {sublabel}
        </p>
      </div>
      <ChipRow presets={presets} value={value} onSelect={onChange} kit={kit} />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={100}
        className={cn(
          "w-full rounded-[8px] border px-3 py-2 text-sm outline-none transition-colors",
          "focus:ring-2 focus:ring-offset-0",
          kit
            ? "border-white/14 bg-white/6 text-white placeholder:text-white/30 focus:border-white/25 focus:ring-white/10"
            : "border-ada-border bg-ada-app text-ada-primary placeholder:text-ada-disabled focus:border-ada-border-active focus:ring-[color-mix(in_srgb,var(--ada-accent)_20%,transparent)]",
        )}
      />
    </div>
  );
}

export function VoiceProfileModal({
  open,
  onOpenChange,
  onSaved,
  variant = "default",
}: VoiceProfileModalProps): JSX.Element {
  const kit = variant === "adaKit";

  const [niche, setNiche] = useState("");
  const [tone, setTone] = useState("");
  const [hookStyle, setHookStyle] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  const nicheRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSaveError(null);
    setSavedOk(false);

    void fetch("/api/voice-profile")
      .then((r) => r.json())
      .then(
        (res: {
          data: VoiceProfileData | null;
          error: string | null;
        }) => {
          if (res.error) return;
          if (res.data) {
            setNiche(res.data.niche ?? "");
            setTone(res.data.tone_preference ?? "");
            setHookStyle(res.data.hook_style ?? "");
          }
        },
      )
      .catch(() => {
        /* non-fatal — user can still type */
      })
      .finally(() => {
        setLoading(false);
        window.setTimeout(() => nicheRef.current?.focus(), 60);
      });
  }, [open]);

  const filledCount = [niche.trim(), tone.trim(), hookStyle.trim()].filter(
    Boolean,
  ).length;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);

    try {
      const res = await fetch("/api/voice-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: niche.trim() || null,
          tone_preference: tone.trim() || null,
          hook_style: hookStyle.trim() || null,
        }),
      });

      const json = (await res.json()) as {
        data: VoiceProfileData | null;
        error: string | null;
      };

      if (!res.ok || json.error) {
        setSaveError("Couldn't save. No changes were lost. Try again.");
        return;
      }

      setSavedOk(true);
      onSaved(
        json.data ?? {
          niche: null,
          tone_preference: null,
          hook_style: null,
        },
      );

      window.setTimeout(() => {
        onOpenChange(false);
        setSavedOk(false);
      }, 900);
    } catch {
      setSaveError("Couldn't save. No changes were lost. Try again.");
    } finally {
      setSaving(false);
    }
  }, [niche, tone, hookStyle, onSaved, onOpenChange]);

  const ringPct = filledCount / 3;
  const r = 9;
  const circ = 2 * Math.PI * r;
  const dash = ringPct * circ;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "max-h-[90dvh] w-[min(480px,95vw)] max-w-[min(480px,95vw)] gap-0 overflow-y-auto p-0 sm:max-w-lg",
          kit
            ? "border-white/15 bg-[#0A050F] text-white"
            : "border-ada-border bg-ada-elevated text-ada-primary",
        )}
        aria-labelledby="vp-modal-title"
        aria-describedby="vp-modal-desc"
      >
        <div
          className={cn(
            "sticky top-0 z-10 flex items-start justify-between gap-4 px-6 pb-4 pt-5",
            kit ? "bg-[#0A050F]" : "bg-ada-elevated",
          )}
        >
          <div className="flex items-center gap-3">
            <div className="relative shrink-0" aria-hidden>
              <svg width="36" height="36" viewBox="0 0 24 24">
                <defs>
                  <linearGradient
                    id="vp-ring-kit"
                    x1="0%"
                    y1="0%"
                    x2="100%"
                    y2="100%"
                  >
                    <stop offset="0%" stopColor="#D31CD7" />
                    <stop offset="100%" stopColor="#8800DC" />
                  </linearGradient>
                </defs>
                <circle
                  cx="12"
                  cy="12"
                  r={r}
                  fill="none"
                  className={kit ? "stroke-white/15" : "stroke-[var(--ada-border)]"}
                  strokeWidth="2.5"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={r}
                  fill="none"
                  stroke={kit ? "url(#vp-ring-kit)" : "var(--ada-accent)"}
                  strokeWidth="2.5"
                  strokeDasharray={`${dash} ${circ}`}
                  strokeLinecap="round"
                  transform="rotate(-90 12 12)"
                  style={{
                    transition:
                      "stroke-dasharray 600ms cubic-bezier(0.16,1,0.3,1)",
                  }}
                />
              </svg>
              <span
                className={cn(
                  "absolute inset-0 flex items-center justify-center text-[9px] font-bold",
                  kit ? "text-white/60" : "text-ada-secondary",
                )}
              >
                {filledCount}/3
              </span>
            </div>

            <div>
              <DialogTitle
                id="vp-modal-title"
                className={cn(
                  "text-base font-semibold tracking-tight",
                  kit ? "text-white" : "text-ada-primary",
                )}
              >
                Your Voice Profile
              </DialogTitle>
              <DialogDescription
                id="vp-modal-desc"
                className={cn(
                  "mt-0.5 text-[11px]",
                  kit ? "text-white/40" : "text-ada-disabled",
                )}
              >
                {filledCount === 0
                  ? "GenEx learns your voice. Every generation gets sharper."
                  : filledCount < 3
                    ? "Add the remaining fields — output improves with each one."
                    : "Profile active. GenEx is generating in your voice."}
              </DialogDescription>
            </div>
          </div>

          <DialogClose
            type="button"
            className={cn(
              "mt-0.5 shrink-0 rounded-full p-1.5 transition-colors",
              kit
                ? "text-white/40 hover:bg-white/8 hover:text-white"
                : "text-ada-secondary hover:bg-ada-card hover:text-ada-primary",
            )}
            aria-label="Close Voice Profile"
          >
            <X className="h-4 w-4" aria-hidden />
          </DialogClose>
        </div>

        <div className="space-y-6 px-6 pb-6">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2
                className={cn(
                  "h-6 w-6 animate-spin",
                  kit ? "text-white/40" : "text-ada-disabled",
                )}
                aria-label="Loading profile"
              />
            </div>
          ) : (
            <>
              <ProfileField
                label="Your Niche"
                sublabel="Unlocks topic-matched hooks and B-roll"
                presets={NICHE_PRESETS}
                value={niche}
                onChange={setNiche}
                placeholder="e.g. Fitness & Health, Real Estate, Gaming…"
                kit={kit}
                inputRef={nicheRef}
              />

              <div
                className={cn("border-t", kit ? "border-white/8" : "border-ada-border")}
              />

              <ProfileField
                label="Your Tone"
                sublabel="Matches every script to how you actually sound"
                presets={TONE_PRESETS}
                value={tone}
                onChange={setTone}
                placeholder="e.g. Conversational, Authoritative, Hype…"
                kit={kit}
              />

              <div
                className={cn("border-t", kit ? "border-white/8" : "border-ada-border")}
              />

              <ProfileField
                label="Hook Style"
                sublabel="Your signature opening — applied to every hook set"
                presets={HOOK_PRESETS}
                value={hookStyle}
                onChange={setHookStyle}
                placeholder="e.g. Bold Statement, Question Hook, Story Open…"
                kit={kit}
              />

              {saveError ? (
                <p
                  className={cn(
                    "rounded-[8px] border px-3 py-2 text-xs",
                    kit
                      ? "border-[color-mix(in_srgb,white_25%,transparent)] bg-[color-mix(in_srgb,var(--ada-error)_12%,transparent)] text-white/90"
                      : "border-[color-mix(in_srgb,var(--ada-error)_30%,transparent)] bg-[color-mix(in_srgb,var(--ada-error)_8%,transparent)] text-ada-error",
                  )}
                  role="alert"
                >
                  {saveError}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || filledCount === 0}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition-all",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  "active:scale-[0.98]",
                  savedOk
                    ? kit
                      ? "border border-white/20 bg-white/10 text-white"
                      : "border border-ada-border bg-[color-mix(in_srgb,var(--ada-success)_12%,transparent)] text-ada-success"
                    : kit
                      ? "bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] text-white hover:opacity-90"
                      : "bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF] text-white hover:opacity-90",
                )}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : savedOk ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : null}
                {saving ? "Saving…" : savedOk ? "Saved" : "Save Voice Profile"}
              </button>

              <p
                className={cn(
                  "text-center text-[10px]",
                  kit ? "text-white/25" : "text-ada-disabled",
                )}
              >
                Your profile is private and only used to improve your output.
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
