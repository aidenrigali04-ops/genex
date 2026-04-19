"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  buildRefinementSteps,
  type RefinementKind,
} from "@/lib/refinement-steps";
import {
  buildSummaryFromContext,
  GENERATION_CONTEXT_VERSION,
  type GenerationContextV1,
} from "@/lib/generation-context";
import type { PlatformId } from "@/lib/platforms";
import { PLATFORM_BY_ID } from "@/lib/platforms";
import { cn } from "@/lib/utils";

export type RefinementChatPanelProps = {
  /** When true, the panel is shown and internal step state resets on activation. */
  active: boolean;
  kind: RefinementKind;
  platformIds: PlatformId[];
  inputSummary: string;
  onConfirm: (ctx: GenerationContextV1) => void;
  onCancel?: () => void;
  variant?: "default" | "adaKit";
  /** Optional header (e.g. dialog title). Omit for compact inline chrome. */
  title?: string;
  description?: string;
  className?: string;
  /** Hide top intro/header (use when an outer shell e.g. Dialog already shows title). */
  hideChrome?: boolean;
  /** Softer shell + omit duplicate input chip (shown as user bubble above in chat). */
  embedInChat?: boolean;
};

function platformLabels(ids: PlatformId[]): string {
  return ids.map((id) => PLATFORM_BY_ID[id]?.label ?? id).join(", ");
}

export function RefinementChatPanel({
  active,
  kind,
  platformIds,
  inputSummary,
  onConfirm,
  onCancel,
  variant = "default",
  title,
  description,
  className,
  hideChrome = false,
  embedInChat = false,
}: RefinementChatPanelProps) {
  const kit = variant === "adaKit";
  const steps = useMemo(
    () => buildRefinementSteps(kind, platformIds),
    [kind, platformIds],
  );

  const totalSteps = steps.length + 1;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customMode, setCustomMode] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const [summaryNiche, setSummaryNiche] = useState("");

  useEffect(() => {
    if (!active) return;
    queueMicrotask(() => {
      setStep(0);
      setAnswers({});
      setCustomMode(false);
      setCustomDraft("");
      setSummaryNiche("");
    });
  }, [active, kind, platformIds]);

  const isSummary = step >= steps.length;
  const currentDef = !isSummary ? steps[step] : null;

  const applyAnswer = useCallback(
    (fieldKey: string, value: string) => {
      setAnswers((prev) => ({ ...prev, [fieldKey]: value }));
      setCustomMode(false);
      setCustomDraft("");
      setStep((s) => s + 1);
    },
    [],
  );

  const handlePill = (fieldKey: string, value: string) => {
    if (value === "__custom__") {
      setCustomMode(true);
      setCustomDraft("");
      return;
    }
    applyAnswer(fieldKey, value);
  };

  const handleCustomSubmit = () => {
    if (!currentDef) return;
    const t = customDraft.trim();
    if (!t) return;
    applyAnswer(currentDef.fieldKey, t);
  };

  const draftContext = useMemo((): GenerationContextV1 => {
    const merged = { ...answers };
    if (summaryNiche.trim()) merged.nicheTheme = summaryNiche.trim();
    return {
      version: GENERATION_CONTEXT_VERSION,
      kind: kind === "video_variations" ? "video_variations" : "text_generation",
      platforms: platformIds,
      answers: merged,
      confirmedAt: new Date().toISOString(),
    };
  }, [answers, summaryNiche, kind, platformIds]);

  const summaryText = useMemo(
    () => buildSummaryFromContext(draftContext),
    [draftContext],
  );

  const handleConfirmGenerate = () => {
    onConfirm(draftContext);
  };

  const goBackToQuestions = () => {
    setStep(0);
    setAnswers({});
    setCustomMode(false);
    setCustomDraft("");
    setSummaryNiche("");
  };

  const bubbleAssistant = kit
    ? "max-w-[95%] rounded-2xl rounded-bl-md border border-white/12 bg-white/[0.08] px-4 py-3 text-sm leading-relaxed text-white/95 backdrop-blur-sm"
    : "max-w-[95%] rounded-2xl rounded-bl-md bg-[#6C47FF]/10 px-4 py-3 text-sm leading-relaxed text-[#0F0A1E] dark:bg-violet-950/40 dark:text-zinc-100";

  const shell = embedInChat
    ? kit
      ? "flex flex-col overflow-hidden rounded-2xl border border-white/12 bg-white/[0.04] backdrop-blur-sm"
      : "flex flex-col overflow-hidden rounded-2xl border border-border bg-card/50"
    : kit
      ? "divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/14 bg-white/[0.06] backdrop-blur-sm outline outline-1 -outline-offset-1 outline-white/10"
      : "flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden rounded-xl border border-[#E8E4F8] bg-white dark:border-white/10 dark:bg-zinc-950";

  if (!active) return null;

  return (
    <div className={cn(shell, "min-h-0 flex-1 flex-col", className)}>
      {!hideChrome && (title ?? description) ? (
        <div
          className={cn(
            "shrink-0 border-b px-4 py-3 text-left",
            kit ? "border-white/10 bg-white/[0.04]" : "border-[#E8E4F8] bg-[#FAFAFC] dark:border-white/10 dark:bg-zinc-900/50",
          )}
        >
          {title ? (
            <h3
              className={cn(
                "text-base font-semibold",
                kit ? "text-white" : "text-[#0F0A1E] dark:text-white",
              )}
            >
              {title}
            </h3>
          ) : null}
          {description ? (
            <p
              className={cn(
                "mt-1 text-sm",
                kit ? "text-white/55" : "text-muted-foreground",
              )}
            >
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      {!hideChrome && !(title ?? description) ? (
        <div
          className={cn(
            "shrink-0 border-b px-4 py-2.5",
            kit ? "border-white/10 bg-white/[0.04]" : "border-border bg-muted/30",
          )}
        >
          <p
            className={cn(
              "text-xs font-medium",
              kit ? "text-white/70" : "text-muted-foreground",
            )}
          >
            A few quick questions for the best clip output
          </p>
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className={cn(
                "mt-1 text-[11px] underline-offset-2 hover:underline",
                kit ? "text-white/45 hover:text-white/70" : "text-muted-foreground",
              )}
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          "text-muted-foreground shrink-0 border-b px-4 py-2 text-xs font-medium",
          kit ? "border-white/10 text-white/50" : "border-[#E8E4F8] dark:border-white/10",
        )}
      >
        Step {Math.min(step + 1, totalSteps)} of {totalSteps}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {!embedInChat ? (
          <div
            className={cn(
              "rounded-xl border px-3 py-2 text-xs",
              kit
                ? "border-white/12 bg-black/20 text-white/80"
                : "border-[#E8E4F8] bg-[#F0EFFE]/60 dark:border-white/10 dark:bg-zinc-900/40",
            )}
          >
            <span className={kit ? "text-white/45" : "text-muted-foreground"}>Input: </span>
            {inputSummary}
          </div>
        ) : null}

        {!isSummary && currentDef ? (
          <>
            <div className="flex justify-start">
              <div className={bubbleAssistant}>
                {step === 0 ? (
                  <>
                    To get the strongest clip package from your prompt, I need a bit of
                    context first.
                    <br />
                    <br />
                  </>
                ) : null}
                {currentDef.message}
              </div>
            </div>

            {customMode && currentDef.allowCustom ? (
              <div className="space-y-2 pl-1">
                <Label
                  htmlFor="refine-custom-inline"
                  className={kit ? "text-white/70" : undefined}
                >
                  Your answer
                </Label>
                <textarea
                  id="refine-custom-inline"
                  className={cn(
                    "min-h-[88px] w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]",
                    kit
                      ? "border-white/14 bg-black/25 text-white ring-violet-500/30 placeholder:text-white/35"
                      : "border-[#E8E4F8] bg-white text-[#0F0A1E] ring-[#6C47FF]/25 dark:border-white/10 dark:bg-zinc-950",
                  )}
                  value={customDraft}
                  onChange={(e) => setCustomDraft(e.target.value)}
                  placeholder="Type your answer…"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setCustomMode(false);
                      setCustomDraft("");
                    }}
                    variant="outline"
                    className={kit ? "border-white/20 bg-transparent text-white hover:bg-white/10" : undefined}
                  >
                    Back to choices
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleCustomSubmit}
                    disabled={!customDraft.trim()}
                    className={
                      kit
                        ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white hover:opacity-90"
                        : undefined
                    }
                  >
                    Continue
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 pl-0.5">
                {currentDef.pills.map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    size="sm"
                    variant="secondary"
                    className={cn(
                      "rounded-full",
                      kit && "border border-white/18 bg-white/10 text-white hover:bg-white/16",
                    )}
                    onClick={() => handlePill(currentDef.fieldKey, p.value)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex justify-start">
              <div className={bubbleAssistant}>
                Generating for <strong>{platformLabels(platformIds)}</strong>
                {summaryText ? (
                  <>
                    <br />
                    <br />
                    {summaryText}
                  </>
                ) : null}
                <br />
                <br />
                Ready to generate?
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="refine-niche-inline" className={kit ? "text-white/70" : undefined}>
                Niche or account theme (optional)
              </Label>
              <input
                id="refine-niche-inline"
                className={cn(
                  "h-10 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-[3px]",
                  kit
                    ? "border-white/14 bg-black/25 text-white ring-violet-500/30 placeholder:text-white/35"
                    : "border-[#E8E4F8] bg-white ring-[#6C47FF]/25 dark:border-white/10 dark:bg-zinc-950",
                )}
                value={summaryNiche}
                onChange={(e) => setSummaryNiche(e.target.value)}
                placeholder="e.g. Islamic content, B2B SaaS, comedy…"
              />
            </div>

            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              <Button
                type="button"
                className={cn(
                  "flex-1",
                  kit &&
                    "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white hover:opacity-90",
                )}
                onClick={handleConfirmGenerate}
              >
                Looks good, Generate
              </Button>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "flex-1",
                  kit && "border-white/20 bg-transparent text-white hover:bg-white/10",
                )}
                onClick={goBackToQuestions}
              >
                Edit answers
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
