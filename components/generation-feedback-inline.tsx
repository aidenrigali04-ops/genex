"use client";

import { GenerationFeedbackPanel } from "@/components/generation-feedback-panel";
import type { GenerationContextV1 } from "@/lib/generation-context";

export type GenerationFeedbackInlineProps = {
  originalPrompt: string;
  generationContext: GenerationContextV1 | null;
  variationsOutput: string;
  variant?: "default" | "adaKit";
};

/** Same behavior as {@link GenerationFeedbackPanel} clip mode, compact for chat turns. */
export function GenerationFeedbackInline({
  originalPrompt,
  generationContext,
  variationsOutput,
  variant = "default",
}: GenerationFeedbackInlineProps) {
  return (
    <div className="w-full min-w-0">
      <GenerationFeedbackPanel
        mode="clip"
        compact
        variant={variant}
        originalPrompt={originalPrompt}
        generationContext={generationContext}
        variationsOutput={variationsOutput}
      />
    </div>
  );
}
