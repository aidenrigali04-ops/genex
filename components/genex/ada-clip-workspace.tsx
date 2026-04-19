"use client";

import { AdaInputCard } from "@/components/genex/ada-input-card";
import { AdaOutputPanel } from "@/components/genex/ada-output-panel";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import type { ClipSectionMap } from "@/lib/clip-package";
import type { GenerationContextV1 } from "@/lib/generation-context";
import type { GenerationPresetId } from "@/lib/generation-presets";
import type { GenerationUiStep } from "@/lib/generation-stream-protocol";
import { cn } from "@/lib/utils";

export type AdaClipWorkspaceProps = {
  inputMode: "text" | "url" | "file";
  onInputModeChange: (m: "text" | "url" | "file") => void;
  text: string;
  onTextChange: (v: string) => void;
  url: string;
  onUrlChange: (v: string) => void;
  uploadFile: File | null;
  onFileChange: (f: File | null) => void;
  selectedModel: string;
  onModelChange: (id: string) => void;
  preset: GenerationPresetId | null;
  onPresetChange: (p: GenerationPresetId | null) => void;
  loading: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  maxUploadMb: number;
  generationSteps: GenerationUiStep[];
  getElapsed: (ts?: number) => string | null;
  error: string | null;
  fetchingYoutubeTranscript: boolean;
  progress: number;
  streamedText: string;
  parsedClipPackage: ClipSectionMap;
  clipFormatTags: string[];
  verticalPreviewText: string;
  copiedId: string | null;
  onCopy: (id: string, body: string) => void;
  onRegenerate: () => void;
  textRatingGenerationId?: string;
  lastClipGenerationContext: GenerationContextV1 | null;
  clipOriginalPromptSummary: string;
  variant?: "default" | "adaKit";
  onTextVideoCreditsRemainingChange?: (remaining: number) => void;
};

const MAGENTA_ACTIVE =
  "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] shadow-[0_0_12px_rgba(203,45,206,0.35)]";

export function AdaClipWorkspace({
  inputMode,
  onInputModeChange,
  text,
  onTextChange,
  url,
  onUrlChange,
  uploadFile,
  onFileChange,
  selectedModel,
  onModelChange,
  preset,
  onPresetChange,
  loading,
  canSubmit,
  onSubmit,
  maxUploadMb,
  generationSteps,
  getElapsed,
  error,
  fetchingYoutubeTranscript,
  progress,
  streamedText,
  parsedClipPackage,
  clipFormatTags,
  verticalPreviewText,
  copiedId,
  onCopy,
  onRegenerate,
  textRatingGenerationId,
  lastClipGenerationContext,
  clipOriginalPromptSummary,
  variant = "default",
  onTextVideoCreditsRemainingChange,
}: AdaClipWorkspaceProps) {
  const kit = variant === "adaKit";

  return (
    <div
      className={cn(
        "flex h-full min-h-0 gap-5 p-4 sm:p-5",
        kit && "font-[family-name:var(--font-instrument-sans)] text-white",
      )}
    >
      <div className="flex w-[360px] shrink-0 flex-col gap-4">
        <AdaInputCard
          inputMode={inputMode}
          onInputModeChange={onInputModeChange}
          text={text}
          onTextChange={onTextChange}
          url={url}
          onUrlChange={onUrlChange}
          uploadFile={uploadFile}
          onFileChange={onFileChange}
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          preset={preset}
          onPresetChange={onPresetChange}
          loading={loading}
          canSubmit={canSubmit}
          onSubmit={onSubmit}
          maxUploadMb={maxUploadMb}
          variant={variant}
        />

        {loading || generationSteps.length > 0 ? (
          <div
            className={cn(
              "divide-y overflow-hidden rounded-2xl border",
              kit
                ? "divide-white/10 border-white/14 bg-white/[0.06] backdrop-blur-sm outline outline-1 -outline-offset-1 outline-white/10"
                : "divide-ada-border rounded-ada-card border-ada-border bg-ada-card",
            )}
          >
            {generationSteps.map((s, i) => (
              <div key={`${s.id}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                <div
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                    i === generationSteps.length - 1 && loading
                      ? kit
                        ? cn(MAGENTA_ACTIVE, "animate-pulse text-white")
                        : "animate-pulse bg-ada-accent text-white"
                      : kit
                        ? "bg-white/10 text-white/45"
                        : "bg-ada-elevated text-ada-disabled",
                  )}
                >
                  {i === generationSteps.length - 1 && loading ? "…" : "✓"}
                </div>
                <span
                  className={cn(
                    "flex-1 text-xs",
                    i === generationSteps.length - 1 && loading
                      ? kit
                        ? "font-medium text-white"
                        : "font-medium text-ada-primary"
                      : kit
                        ? "text-white/45"
                        : "text-ada-disabled",
                  )}
                >
                  {s.label}
                </span>
                {getElapsed(s.ts) ? (
                  <span
                    className={cn(
                      "tabular-nums text-[10px]",
                      kit ? "text-white/40" : "text-ada-disabled",
                    )}
                  >
                    {getElapsed(s.ts)}
                  </span>
                ) : null}
              </div>
            ))}
            {loading && generationSteps.length === 0 ? (
              <div
                className={cn(
                  "animate-pulse px-4 py-3 text-xs",
                  kit ? "text-white/45" : "text-ada-disabled",
                )}
              >
                Connecting…
              </div>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3">
            <Progress
              value={fetchingYoutubeTranscript ? 18 : progress}
              className="w-full"
              trackClassName={kit ? "bg-white/12" : undefined}
              indicatorClassName={
                kit
                  ? "bg-[linear-gradient(90deg,#D31CD7_0%,#8800DC_100%)]"
                  : undefined
              }
            >
              <div className="flex w-full items-center justify-between gap-2">
                <ProgressLabel className={kit ? "text-sm font-medium text-white/85" : undefined}>
                  {fetchingYoutubeTranscript
                    ? "YouTube"
                    : (generationSteps.at(-1)?.label ?? "Generating")}
                </ProgressLabel>
                <ProgressValue
                  className={kit ? "text-sm text-white/55 tabular-nums" : undefined}
                />
              </div>
            </Progress>
            <p className={cn("text-xs", kit ? "text-white/50" : "text-ada-secondary")}>
              {fetchingYoutubeTranscript
                ? "Fetching captions before generation…"
                : generationSteps.length > 0
                  ? "Streaming your clip package…"
                  : "Connecting to the server…"}
            </p>
          </div>
        ) : null}

        {error ? (
          <div
            className={cn(
              "rounded-xl border px-4 py-3 text-sm",
              kit
                ? "border-red-400/35 bg-red-950/40 text-red-100"
                : "rounded-ada-input border-ada-error/30 bg-ada-error/10 text-ada-error",
            )}
            role="alert"
          >
            {error}
          </div>
        ) : null}
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto pr-1">
        <AdaOutputPanel
          loading={loading}
          streamedText={streamedText}
          parsedClipPackage={parsedClipPackage}
          clipFormatTags={clipFormatTags}
          verticalPreviewText={verticalPreviewText}
          copiedId={copiedId}
          onCopy={onCopy}
          onRegenerate={onRegenerate}
          canRegenerate={canSubmit && !loading}
          generationId={textRatingGenerationId}
          generationContext={lastClipGenerationContext}
          originalPrompt={clipOriginalPromptSummary}
          variant={variant}
          onTextVideoCreditsRemainingChange={onTextVideoCreditsRemainingChange}
        />
      </div>
    </div>
  );
}
