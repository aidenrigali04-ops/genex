"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: RefinementKind;
  platformIds: PlatformId[];
  /** Short line: source type + user hint */
  inputSummary: string;
  onConfirm: (ctx: GenerationContextV1) => void;
};

function platformLabels(ids: PlatformId[]): string {
  return ids.map((id) => PLATFORM_BY_ID[id]?.label ?? id).join(", ");
}

export function RefinementChatDialog({
  open,
  onOpenChange,
  kind,
  platformIds,
  inputSummary,
  onConfirm,
}: Props) {
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

  /** Controlled `open` from parent does not always trigger `onOpenChange(true)`. */
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setStep(0);
      setAnswers({});
      setCustomMode(false);
      setCustomDraft("");
      setSummaryNiche("");
    });
  }, [open, kind, platformIds]);

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
    onOpenChange(false);
  };

  const goBackToQuestions = () => {
    setStep(0);
    setAnswers({});
    setCustomMode(false);
    setCustomDraft("");
    setSummaryNiche("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-border shrink-0 border-b px-6 py-4 text-left">
          <DialogTitle>Refinement chat</DialogTitle>
          <DialogDescription>
            A few quick questions so we can tailor this run. {inputSummary}
          </DialogDescription>
        </DialogHeader>

        <div className="text-muted-foreground shrink-0 border-b border-border px-6 py-2 text-xs font-medium">
          Step {Math.min(step + 1, totalSteps)} of {totalSteps}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="bg-muted/50 rounded-xl border border-border px-3 py-2 text-xs">
            <span className="text-muted-foreground">Input: </span>
            {inputSummary}
          </div>

          {!isSummary && currentDef ? (
            <>
              <div className="flex justify-start">
                <div className="bg-primary/12 text-foreground max-w-[95%] rounded-2xl rounded-bl-md px-4 py-3 text-sm leading-relaxed">
                  {currentDef.message}
                </div>
              </div>

              {customMode && currentDef.allowCustom ? (
                <div className="space-y-2 pl-2">
                  <Label htmlFor="refine-custom">Your answer</Label>
                  <textarea
                    id="refine-custom"
                    className="border-input bg-background ring-ring/50 focus-visible:ring-[3px] min-h-[88px] w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none"
                    value={customDraft}
                    onChange={(e) => setCustomDraft(e.target.value)}
                    placeholder="Type your answer…"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setCustomMode(false);
                        setCustomDraft("");
                      }}
                      variant="outline"
                    >
                      Back to choices
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleCustomSubmit}
                      disabled={!customDraft.trim()}
                    >
                      Continue
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 pl-1">
                  {currentDef.pills.map((p) => (
                    <Button
                      key={p.label}
                      type="button"
                      size="sm"
                      variant="secondary"
                      className={cn("rounded-full")}
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
                <div className="bg-primary/12 text-foreground max-w-[95%] rounded-2xl rounded-bl-md px-4 py-3 text-sm leading-relaxed">
                  Generating for{" "}
                  <strong>{platformLabels(platformIds)}</strong>
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
                <Label htmlFor="refine-niche">Niche or account theme (optional)</Label>
                <input
                  id="refine-niche"
                  className="border-input bg-background ring-ring/50 focus-visible:ring-[3px] h-10 w-full rounded-lg border px-3 text-sm outline-none"
                  value={summaryNiche}
                  onChange={(e) => setSummaryNiche(e.target.value)}
                  placeholder="e.g. Islamic content, B2B SaaS, comedy…"
                />
              </div>

              <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                <Button
                  type="button"
                  className="flex-1"
                  onClick={handleConfirmGenerate}
                >
                  Looks good, Generate
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={goBackToQuestions}
                >
                  Edit answers
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
