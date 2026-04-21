"use client";

import type { JSX, KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export type VoiceProfileData = {
  niche: string;
  tone_preference: string;
  hook_style: string;
};

export type AdaVoiceProfileModalProps = {
  open: boolean;
  initial?: Partial<VoiceProfileData> | null;
  onSave: (data: VoiceProfileData) => Promise<void>;
  onClose: () => void;
  variant?: "default" | "adaKit";
};

const NICHE_OPTIONS: { value: string; label: string }[] = [
  { value: "fitness", label: "fitness" },
  { value: "food & cooking", label: "food & cooking" },
  { value: "finance & money", label: "finance & money" },
  { value: "travel", label: "travel" },
  { value: "beauty & fashion", label: "beauty & fashion" },
  { value: "gaming", label: "gaming" },
  { value: "tech & gadgets", label: "tech & gadgets" },
  { value: "education & how-to", label: "education & how-to" },
  { value: "entertainment & pop culture", label: "entertainment & pop culture" },
  { value: "business & entrepreneurship", label: "business & entrepreneurship" },
  { value: "parenting & family", label: "parenting & family" },
  { value: "lifestyle & wellness", label: "lifestyle & wellness" },
  { value: "other", label: "other" },
];

const TONE_OPTIONS = [
  "casual & relatable",
  "bold & direct",
  "educational & calm",
  "hype & energetic",
] as const;

const HOOK_OPTIONS = [
  "bold statement",
  "question hook",
  "story open",
  "shock & curiosity",
] as const;

function isValidNiche(v: string): boolean {
  return NICHE_OPTIONS.some((o) => o.value === v);
}

function useRovingRadioKeyNav(
  items: readonly string[],
  selected: string,
  onSelect: (value: string) => void,
): (e: KeyboardEvent<HTMLDivElement>) => void {
  return (e) => {
    if (items.length === 0) return;
    const idx = items.indexOf(selected);

    const focusPill = (value: string) => {
      const esc =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(value)
          : value.replace(/"/g, '\\"');
      (
        e.currentTarget.querySelector(
          `[data-pill-value="${esc}"]`,
        ) as HTMLElement | null
      )?.focus();
    };

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next =
        idx < 0 ? 0 : (idx + 1) % items.length;
      const val = items[next] ?? items[0] ?? "";
      onSelect(val);
      focusPill(val);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const next =
        idx < 0
          ? items.length - 1
          : (idx - 1 + items.length) % items.length;
      const val = items[next] ?? items[0] ?? "";
      onSelect(val);
      focusPill(val);
    } else if (e.key === "Home") {
      e.preventDefault();
      const val = items[0] ?? "";
      onSelect(val);
      focusPill(val);
    } else if (e.key === "End") {
      e.preventDefault();
      const last = items[items.length - 1] ?? "";
      onSelect(last);
      focusPill(last);
    }
  };
}

export function AdaVoiceProfileModal({
  open,
  initial = null,
  onSave,
  onClose,
  variant = "default",
}: AdaVoiceProfileModalProps): JSX.Element {
  const kit = variant === "adaKit";
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstFocusRef = useRef<HTMLSelectElement>(null);
  const lastActiveRef = useRef<Element | null>(null);

  const [niche, setNiche] = useState("");
  const [tone, setTone] = useState("");
  const [hookStyle, setHookStyle] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedUi, setSavedUi] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const toneNav = useRovingRadioKeyNav(TONE_OPTIONS, tone, setTone);
  const hookNav = useRovingRadioKeyNav(HOOK_OPTIONS, hookStyle, setHookStyle);

  useEffect(() => {
    if (!dialogRef.current) return;
    if (open) {
      lastActiveRef.current = document.activeElement;
      dialogRef.current.showModal();
      window.setTimeout(() => firstFocusRef.current?.focus(), 50);
    } else {
      dialogRef.current.close();
      const prev = lastActiveRef.current;
      if (prev instanceof HTMLElement) {
        window.requestAnimationFrame(() => {
          prev.focus();
        });
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const rawNiche = initial?.niche?.trim() ?? "";
    const t = initial?.tone_preference?.trim() ?? "";
    const h = initial?.hook_style?.trim() ?? "";
    queueMicrotask(() => {
      setNiche(isValidNiche(rawNiche) ? rawNiche : "");
      setTone(TONE_OPTIONS.includes(t as (typeof TONE_OPTIONS)[number]) ? t : "");
      setHookStyle(
        HOOK_OPTIONS.includes(h as (typeof HOOK_OPTIONS)[number]) ? h : "",
      );
      setSaving(false);
      setSavedUi(false);
      setSaveError(false);
    });
  }, [open, initial]);

  const handleDialogCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (!niche || !tone || !hookStyle) return;
    setSaveError(false);
    setSaving(true);
    const payload: VoiceProfileData = {
      niche,
      tone_preference: tone,
      hook_style: hookStyle,
    };
    try {
      await onSave(payload);
      setSaving(false);
      setSavedUi(true);
      window.setTimeout(() => {
        setSavedUi(false);
        onClose();
      }, 1000);
    } catch {
      setSaving(false);
      setSaveError(true);
    }
  }, [niche, tone, hookStyle, onSave, onClose]);

  const panelClass = kit
    ? "bg-[#0D0A1E] border-white/14"
    : "bg-[var(--ada-bg-elevated)] border-[var(--ada-border)]";
  const titleClass = kit ? "text-white" : "text-[var(--ada-text-primary)]";
  const subClass = kit ? "text-white/60" : "text-[var(--ada-text-secondary)]";
  const selectClass = kit
    ? "bg-white/[0.06] border-white/14 text-white"
    : "bg-[var(--ada-bg-card)] border-[var(--ada-border)] text-[var(--ada-text-primary)]";
  const pillIdle = kit
    ? "border-white/20 text-white/60 hover:border-white/40"
    : "border-ada-border text-ada-secondary hover:border-ada-border-active";
  const pillSelected = "bg-ada-accent text-white border-transparent";
  const saveBtnClass = kit
    ? "bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] text-white"
    : "bg-[var(--ada-accent)] text-white";

  const canSave = Boolean(niche && tone && hookStyle);

  return (
    <>
      <style>{`
        .ada-voice-profile-dialog::backdrop {
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
        }
      `}</style>
      <dialog
        ref={dialogRef}
        className={cn(
          "ada-voice-profile-dialog fixed inset-0 z-[100] m-0 flex max-h-none w-full max-w-none items-center justify-center border-0 bg-transparent p-4",
        )}
        aria-labelledby="voice-profile-modal-title"
        aria-modal="true"
        onCancel={handleDialogCancel}
        onClick={(e) => {
          if (e.target === dialogRef.current) onClose();
        }}
      >
        <div
          className={cn(
            "relative w-full max-w-md rounded-2xl border p-6 shadow-lg",
            panelClass,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1 flex items-start justify-between gap-3">
            <div>
              <h2
                id="voice-profile-modal-title"
                className={cn("text-lg font-semibold", titleClass)}
              >
                Your Voice Profile
              </h2>
              <p className={cn("mt-1 text-sm", subClass)}>
                GenEx uses this to personalize every generation.
              </p>
            </div>
            <button
              type="button"
              className={cn(
                "rounded-lg p-1.5 transition-colors",
                kit ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-[var(--ada-text-secondary)] hover:bg-[var(--ada-bg-card)] hover:text-[var(--ada-text-primary)]",
              )}
              aria-label="Close Voice Profile"
              onClick={onClose}
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>

          <div className="mt-6 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="voice-profile-niche"
                className={cn("text-sm font-medium", titleClass)}
              >
                What do you create?
              </label>
              <select
                ref={firstFocusRef}
                id="voice-profile-niche"
                aria-label="Creator niche"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                className={cn(
                  "w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ada-accent)]",
                  selectClass,
                )}
              >
                <option value="" disabled>
                  Choose your niche…
                </option>
                {NICHE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <span className={cn("text-sm font-medium", titleClass)}>
                How do you sound?
              </span>
              <div
                role="radiogroup"
                aria-label="Tone preference"
                className="flex flex-wrap gap-2"
                onKeyDown={toneNav}
              >
                {TONE_OPTIONS.map((label) => {
                  const sel = tone === label;
                  const tabbable =
                    sel || (tone === "" && label === TONE_OPTIONS[0]);
                  return (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={sel}
                      data-pill-value={label}
                      tabIndex={tabbable ? 0 : -1}
                      onClick={() => setTone(label)}
                      className={cn(
                        "rounded-full border px-3 py-2 text-left text-xs font-medium transition-colors",
                        sel ? pillSelected : pillIdle,
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className={cn("text-sm font-medium", titleClass)}>
                How do you open videos?
              </span>
              <div
                role="radiogroup"
                aria-label="Hook style"
                className="flex flex-wrap gap-2"
                onKeyDown={hookNav}
              >
                {HOOK_OPTIONS.map((label) => {
                  const sel = hookStyle === label;
                  const tabbable =
                    sel ||
                    (hookStyle === "" && label === HOOK_OPTIONS[0]);
                  return (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={sel}
                      data-pill-value={label}
                      tabIndex={tabbable ? 0 : -1}
                      onClick={() => setHookStyle(label)}
                      className={cn(
                        "rounded-full border px-3 py-2 text-left text-xs font-medium transition-colors",
                        sel ? pillSelected : pillIdle,
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              className="rounded-full px-4 py-2 text-sm font-medium text-[var(--ada-text-secondary)] transition-colors hover:text-[var(--ada-text-primary)]"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSave || saving || savedUi}
              className={cn(
                "inline-flex min-w-[120px] items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50",
                saveBtnClass,
              )}
              onClick={() => void handleSave()}
            >
              {saving ? (
                <>
                  <Zap className="size-4 shrink-0 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : savedUi ? (
                <>
                  <Check className="size-4 shrink-0" aria-hidden />
                  Saved ✓
                </>
              ) : (
                "Save"
              )}
            </button>
          </div>

          {saveError ? (
            <p className="mt-3 text-xs text-[var(--ada-error)]">
              Couldn&apos;t save. No changes were made.
            </p>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
