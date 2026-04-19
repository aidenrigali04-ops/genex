"use client";

import { Zap } from "lucide-react";

import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import { extractPlatformSection } from "@/lib/parse-generation-output";
import type { PlatformId } from "@/lib/platforms";
import {
  parseClipPackageSections,
} from "@/lib/clip-package";
import type { GenerationUiStep } from "@/lib/generation-stream-protocol";
import { cn } from "@/lib/utils";

import { AdaOutputSections } from "./ada-output-sections";

const CLIP_PLATFORMS: PlatformId[] = ["clip_package"];

function clipPackageBodyFromStream(streamedText: string): string {
  const extracted = extractPlatformSection(
    streamedText,
    "clip_package",
    CLIP_PLATFORMS,
  );
  if (extracted.trim()) return extracted;
  if (/TOP CLIP MOMENTS/i.test(streamedText)) return streamedText.trim();
  return "";
}

export type AdaLiveTurnProps = {
  streamedText: string;
  generationSteps: GenerationUiStep[];
  progress: number;
  fetchingYoutubeTranscript: boolean;
  getElapsed: (ts?: number) => string | null;
  copiedId: string | null;
  onCopy: (id: string, body: string) => void | Promise<void>;
  variant?: "default" | "adaKit";
};

export function AdaLiveTurn({
  streamedText,
  generationSteps,
  progress,
  fetchingYoutubeTranscript,
  getElapsed,
  copiedId,
  onCopy,
  variant = "default",
}: AdaLiveTurnProps) {
  const kit = variant === "adaKit";
  const body = clipPackageBodyFromStream(streamedText);
  const parsed = parseClipPackageSections(body);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm",
            kit
              ? "bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] shadow-[#8800DC33]"
              : "bg-gradient-to-br from-[#7B5CFA] to-[#9B6FFF] shadow-[#7B5CFA33]",
          )}
        >
          <Zap className="h-4 w-4 text-white" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-3 pt-1">
          {generationSteps.length > 0 && !streamedText.trim() ? (
            <div className="space-y-1.5">
              {generationSteps.map((s, i) => (
                <div key={`${s.id}-${i}`} className="flex items-center gap-2">
                  <div
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      i === generationSteps.length - 1
                        ? kit
                          ? "animate-pulse bg-white"
                          : "animate-pulse bg-[var(--ada-accent)]"
                        : kit
                          ? "bg-white/35"
                          : "bg-[var(--ada-border-active)]",
                    )}
                  />
                  <span
                    className={cn(
                      "text-xs",
                      i === generationSteps.length - 1
                        ? kit
                          ? "text-white/85"
                          : "text-[var(--ada-text-secondary)]"
                        : kit
                          ? "text-white/40"
                          : "text-[var(--ada-text-disabled)]",
                    )}
                  >
                    {s.label}
                  </span>
                  {getElapsed(s.ts) ? (
                    <span
                      className={cn(
                        "ml-auto tabular-nums text-[10px]",
                        kit ? "text-white/35" : "text-[var(--ada-text-disabled)]",
                      )}
                    >
                      {getElapsed(s.ts)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {!streamedText.trim() &&
          (fetchingYoutubeTranscript || generationSteps.length > 0) ? (
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
              <p
                className={cn(
                  "text-xs",
                  kit ? "text-white/50" : "text-[var(--ada-text-secondary)]",
                )}
              >
                {fetchingYoutubeTranscript
                  ? "Fetching captions before generation…"
                  : generationSteps.length > 0
                    ? "Streaming your clip package…"
                    : "Connecting to the server…"}
              </p>
            </div>
          ) : null}

          {streamedText.trim() ? (
            <div
              className={cn(
                "prose prose-sm max-w-none",
                kit && "prose-invert text-white/95",
              )}
            >
              <AdaOutputSections
                parsedClipPackage={parsed}
                streamedText={streamedText}
                loading
                copiedId={copiedId}
                onCopy={onCopy}
                variant={variant}
              />
            </div>
          ) : generationSteps.length === 0 && !fetchingYoutubeTranscript ? (
            <div className="flex h-6 items-center gap-1 pt-0.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={cn(
                    "h-2 w-2 animate-bounce rounded-full",
                    kit ? "bg-white/40" : "bg-[var(--ada-border-active)]",
                  )}
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
