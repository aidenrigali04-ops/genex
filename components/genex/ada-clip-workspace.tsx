"use client";

import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";

import { AdaInputCard } from "@/components/genex/ada-input-card";
import { AdaOutputPanel } from "@/components/genex/ada-output-panel";
import { RefinementChatPanel } from "@/components/refinement-chat-panel";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import type { ClipSectionMap } from "@/lib/clip-package";
import type { PlatformId } from "@/lib/platforms";
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
  refinementOpen?: boolean;
  refinementPlatformIds?: PlatformId[];
  refinementInputSummary?: string;
  onRefinementConfirm?: (ctx: GenerationContextV1) => void;
  onRefinementCancel?: () => void;
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
  refinementOpen = false,
  refinementPlatformIds = ["clip_package"],
  refinementInputSummary = "",
  onRefinementConfirm,
  onRefinementCancel,
}: AdaClipWorkspaceProps) {
  const kit = variant === "adaKit";
  const endRef = useRef<HTMLDivElement>(null);

  const userLine =
    clipOriginalPromptSummary.trim() ||
    (inputMode === "url" ? url.trim() : "") ||
    (uploadFile ? `File: ${uploadFile.name}` : "") ||
    (inputMode === "text" ? text.trim().slice(0, 2000) : "");

  const showUserBubble =
    Boolean(userLine) &&
    (refinementOpen ||
      loading ||
      generationSteps.length > 0 ||
      Boolean(streamedText.trim()));

  const showIdleHint =
    !refinementOpen &&
    !loading &&
    generationSteps.length === 0 &&
    !streamedText.trim() &&
    !error;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [
    streamedText,
    generationSteps.length,
    loading,
    refinementOpen,
    error,
    refinementInputSummary,
  ]);

  const userBubbleClass = kit
    ? "max-w-[min(100%,85%)] whitespace-pre-wrap rounded-[20px_4px_20px_20px] bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] px-4 py-3 text-sm leading-relaxed text-white shadow-[0_16px_24px_rgba(136,1,220,0.16)] outline outline-1 -outline-offset-1 outline-white/25"
    : "max-w-[min(100%,85%)] whitespace-pre-wrap rounded-2xl rounded-br-md border border-ada-border bg-ada-elevated px-4 py-3 text-sm leading-relaxed text-ada-primary";

  const assistantShell = kit
    ? "w-full max-w-[min(100%,920px)] space-y-3 rounded-[20px_20px_20px_4px] border border-white/15 bg-white/[0.08] p-4 shadow-[0_12px_24px_rgba(11,6,16,0.24)] outline outline-1 -outline-offset-1 outline-white/20"
    : "w-full max-w-[min(100%,920px)] space-y-3 rounded-2xl rounded-bl-md border border-ada-border bg-ada-card p-4 shadow-sm";

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col",
        kit && "font-[family-name:var(--font-instrument-sans)] text-white",
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[920px] flex-col gap-4">
          {showIdleHint ? (
            <div
              className={cn(
                "flex min-h-[38vh] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center text-sm",
                kit
                  ? "border-white/15 text-white/45"
                  : "border-ada-border text-ada-secondary",
              )}
            >
              <Sparkles
                className={cn("size-10", kit ? "text-white/35" : "text-ada-disabled")}
                aria-hidden
              />
              <p className="max-w-sm">
                Chat with GenEx below — refinement and your clip package stream here in one
                thread.
              </p>
            </div>
          ) : null}

          {showUserBubble ? (
            <div className="flex justify-end">
              <div className={userBubbleClass}>{userLine}</div>
            </div>
          ) : null}

          {refinementOpen && !loading && onRefinementConfirm ? (
            <div className="flex w-full justify-start">
              <div className="w-full max-w-[min(100%,920px)]">
                <RefinementChatPanel
                  active={refinementOpen}
                  kind="text_generation"
                  platformIds={refinementPlatformIds}
                  inputSummary={refinementInputSummary}
                  variant={variant}
                  embedInChat
                  className="max-h-none min-h-0"
                  onConfirm={onRefinementConfirm}
                  onCancel={onRefinementCancel}
                />
              </div>
            </div>
          ) : null}

          {loading || generationSteps.length > 0 ? (
            <div className="flex w-full justify-start">
              <div className={assistantShell}>
                <div
                  className={cn(
                    "flex items-center gap-2 border-b pb-2",
                    kit ? "border-white/10" : "border-ada-border",
                  )}
                >
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full shadow-[0_0_16px_rgba(203,45,206,0.24)]",
                      kit
                        ? "bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)]"
                        : "bg-ada-accent",
                    )}
                  >
                    <Sparkles className="size-4 text-white" aria-hidden />
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium tracking-wide",
                      kit ? "text-[#E8B4FF]" : "text-ada-accent-hover",
                    )}
                  >
                    GenEx
                  </span>
                </div>

                {kit ? (
                  <div
                    className="h-11 w-full overflow-hidden rounded-xl opacity-90"
                    style={{
                      background:
                        "linear-gradient(110deg, rgba(54,0,170,0.45) 0%, rgba(136,0,220,0.35) 45%, rgba(164,0,167,0.4) 100%)",
                    }}
                    aria-hidden
                  />
                ) : null}

                <div
                  className={cn(
                    "divide-y overflow-hidden rounded-xl border",
                    kit
                      ? "divide-white/10 border-white/12 bg-black/20"
                      : "divide-ada-border border-ada-border bg-ada-sidebar/60",
                  )}
                >
                  {generationSteps.map((s, i) => (
                    <div key={`${s.id}-${i}`} className="flex items-center gap-3 px-3 py-2">
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
                        "animate-pulse px-3 py-2.5 text-xs",
                        kit ? "text-white/45" : "text-ada-disabled",
                      )}
                    >
                      Connecting…
                    </div>
                  ) : null}
                </div>

                {loading ? (
                  <div className="space-y-2">
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
                        <ProgressLabel
                          className={kit ? "text-xs font-medium text-white/85" : undefined}
                        >
                          {fetchingYoutubeTranscript
                            ? "YouTube"
                            : (generationSteps.at(-1)?.label ?? "Generating")}
                        </ProgressLabel>
                        <ProgressValue
                          className={kit ? "text-xs text-white/55 tabular-nums" : undefined}
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
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="flex justify-start">
              <div
                className={cn(
                  "max-w-[min(100%,92%)] rounded-2xl border px-4 py-3 text-sm",
                  kit
                    ? "border-red-400/35 bg-red-950/50 text-red-100"
                    : "border-ada-error/30 bg-ada-error/10 text-ada-error",
                )}
                role="alert"
              >
                {error}
              </div>
            </div>
          ) : null}

          {streamedText.trim() ? (
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
              chatEmbedded={kit}
            />
          ) : null}

          <div ref={endRef} className="h-px shrink-0 scroll-mt-24" aria-hidden />
        </div>
      </div>

      <footer
        className={cn(
          "shrink-0 border-t px-4 py-3 sm:px-6",
          kit
            ? "border-white/10 bg-[#0A050F]/85 backdrop-blur-md"
            : "border-ada-border bg-ada-app/95 backdrop-blur-sm",
        )}
      >
        <div className="mx-auto w-full max-w-[920px]">
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
            refinementActive={refinementOpen}
          />
        </div>
      </footer>
    </div>
  );
}
