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
};

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
}: AdaClipWorkspaceProps) {
  return (
    <div className="flex h-full min-h-0 gap-5 p-5">
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
        />

        {loading || generationSteps.length > 0 ? (
          <div className="divide-y divide-ada-border overflow-hidden rounded-ada-card border border-ada-border bg-ada-card">
            {generationSteps.map((s, i) => (
              <div key={`${s.id}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                <div
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                    i === generationSteps.length - 1 && loading
                      ? "animate-pulse bg-ada-accent text-white"
                      : "bg-ada-elevated text-ada-disabled",
                  )}
                >
                  {i === generationSteps.length - 1 && loading ? "…" : "✓"}
                </div>
                <span
                  className={cn(
                    "flex-1 text-xs",
                    i === generationSteps.length - 1 && loading
                      ? "font-medium text-ada-primary"
                      : "text-ada-disabled",
                  )}
                >
                  {s.label}
                </span>
                {getElapsed(s.ts) ? (
                  <span className="tabular-nums text-[10px] text-ada-disabled">
                    {getElapsed(s.ts)}
                  </span>
                ) : null}
              </div>
            ))}
            {loading && generationSteps.length === 0 ? (
              <div className="animate-pulse px-4 py-3 text-xs text-ada-disabled">Connecting…</div>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3">
            <Progress value={fetchingYoutubeTranscript ? 18 : progress} className="w-full">
              <div className="flex w-full items-center justify-between gap-2">
                <ProgressLabel>
                  {fetchingYoutubeTranscript
                    ? "YouTube"
                    : (generationSteps.at(-1)?.label ?? "Generating")}
                </ProgressLabel>
                <ProgressValue />
              </div>
            </Progress>
            <p className="text-xs text-ada-secondary">
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
            className="rounded-ada-input border border-ada-error/30 bg-ada-error/10 px-4 py-3 text-sm text-ada-error"
            role="alert"
          >
            {error}
          </div>
        ) : null}
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
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
        />
      </div>
    </div>
  );
}
