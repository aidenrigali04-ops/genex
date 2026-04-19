"use client";

import {
  ArrowDown,
  Copy,
  Link2,
  Paperclip,
  RefreshCw,
  Zap,
} from "lucide-react";

import { GenerationFeedbackInline } from "@/components/generation-feedback-inline";
import { RatingWidget } from "@/components/rating-widget";
import { TextToVideoLauncher } from "@/components/genex/text-to-video-launcher";
import { CLIP_SECTIONS, type ClipSectionMap } from "@/lib/clip-package";
import type { GenerationContextV1 } from "@/lib/generation-context";
import type { GenerationPresetId } from "@/lib/generation-presets";
import type { ClipTurn } from "@/lib/clip-turn";
import { cn } from "@/lib/utils";

import { AdaOutputSections } from "./ada-output-sections";

function formatRelativeTime(d: Date): string {
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 45) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function joinClipPackageForCopy(pkg: ClipSectionMap): string {
  return CLIP_SECTIONS.map((s) => {
    const c = pkg[s.id]?.trim();
    if (!c) return "";
    return `${s.label}\n${c}`;
  })
    .filter(Boolean)
    .join("\n\n");
}

function presetLabel(p: GenerationPresetId): string {
  return p.replace(/_/g, " ");
}

export type AdaTurnProps = {
  turn: ClipTurn;
  isLast: boolean;
  copiedId: string | null;
  onCopy: (id: string, body: string) => void | Promise<void>;
  onRegenerate: () => void;
  onTextVideoCreditsRemainingChange?: (remaining: number) => void;
  variant?: "default" | "adaKit";
};

export function AdaTurn({
  turn,
  isLast,
  copiedId,
  onCopy,
  onRegenerate,
  onTextVideoCreditsRemainingChange,
  variant = "default",
}: AdaTurnProps) {
  const kit = variant === "adaKit";

  const copyAll = () => {
    void onCopy("__all__", joinClipPackageForCopy(turn.parsedClipPackage));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <div
          className={cn(
            "max-w-[85%] rounded-[18px] rounded-br-[4px] border px-4 py-3",
            kit
              ? "border-white/14 bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] text-white shadow-[0_12px_28px_rgba(136,1,220,0.22)]"
              : "border-[var(--ada-border)] bg-[var(--ada-bg-elevated)]",
          )}
        >
          {turn.inputMode !== "text" ? (
            <div className="mb-2 flex items-center gap-1.5">
              {turn.inputMode === "url" ? (
                <Link2
                  className={cn(
                    "h-3 w-3",
                    kit ? "text-white/90" : "text-[var(--ada-accent)]",
                  )}
                />
              ) : (
                <Paperclip
                  className={cn(
                    "h-3 w-3",
                    kit ? "text-white/90" : "text-[var(--ada-accent)]",
                  )}
                />
              )}
              <span
                className={cn(
                  "text-[10px] font-medium tracking-wide uppercase",
                  kit ? "text-white/80" : "text-[var(--ada-accent)]",
                )}
              >
                {turn.inputMode}
              </span>
            </div>
          ) : null}

          <p
            className={cn(
              "text-sm leading-relaxed break-words",
              kit ? "text-white" : "text-[var(--ada-text-primary)]",
            )}
          >
            {turn.userMessage}
          </p>

          {turn.preset ? (
            <div className="mt-2">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  kit
                    ? "bg-white/20 text-white"
                    : "bg-[var(--ada-accent)]/20 text-[var(--ada-accent-hover)]",
                )}
              >
                {presetLabel(turn.preset)}
              </span>
            </div>
          ) : null}

          <p
            className={cn(
              "mt-1.5 text-right text-[10px]",
              kit ? "text-white/45" : "text-[var(--ada-text-disabled)]",
            )}
            suppressHydrationWarning
          >
            {formatRelativeTime(turn.timestamp)}
          </p>
        </div>
      </div>

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

        <div className="min-w-0 flex-1 space-y-3">
          <AdaOutputSections
            parsedClipPackage={turn.parsedClipPackage}
            copiedId={copiedId}
            loading={false}
            streamedText={turn.rawText}
            onCopy={onCopy}
            variant={variant}
          />

          {isLast ? (
            <div className="space-y-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={copyAll}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[6px] border border-transparent px-2.5 py-1.5 text-xs transition-colors",
                    kit
                      ? "text-white/55 hover:border-white/20 hover:text-white/90"
                      : "text-[var(--ada-text-disabled)] hover:border-[var(--ada-border)] hover:text-[var(--ada-text-secondary)]",
                  )}
                >
                  <Copy className="h-3 w-3" />
                  Copy all
                </button>
                <button
                  type="button"
                  onClick={onRegenerate}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[6px] border border-transparent px-2.5 py-1.5 text-xs transition-colors",
                    kit
                      ? "text-white/55 hover:border-white/20 hover:text-white/90"
                      : "text-[var(--ada-text-disabled)] hover:border-[var(--ada-border)] hover:text-[var(--ada-text-secondary)]",
                  )}
                >
                  <RefreshCw className="h-3 w-3" />
                  Regenerate
                </button>
              </div>
              <GenerationFeedbackInline
                originalPrompt={turn.userMessage || "Clip package"}
                generationContext={turn.generationContext}
                variationsOutput={turn.rawText}
                variant={variant}
              />
            </div>
          ) : null}

          {isLast ? (
            <div
              className={cn(
                "rounded-xl border px-3 py-2.5",
                kit ? "border-white/12 bg-white/[0.04]" : "border-ada-border bg-ada-sidebar/80",
              )}
            >
              <RatingWidget
                kind="text"
                generationId={turn.generationId ?? undefined}
              />
            </div>
          ) : null}

          {isLast && turn.parsedClipPackage.script.trim() ? (
            <>
              <div className="flex items-center gap-3 py-1">
                <div
                  className={cn(
                    "h-px flex-1",
                    kit ? "bg-white/12" : "bg-[var(--ada-border)]",
                  )}
                />
                <div
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1",
                    kit
                      ? "border-white/14 bg-white/[0.06]"
                      : "border-[var(--ada-border)] bg-[var(--ada-bg-elevated)]",
                  )}
                >
                  <ArrowDown
                    className={cn(
                      "h-3 w-3",
                      kit ? "text-[#E8B4FF]" : "text-[var(--ada-accent)]",
                    )}
                  />
                  <span
                    className={cn(
                      "text-[10px] font-medium",
                      kit ? "text-white/70" : "text-[var(--ada-text-secondary)]",
                    )}
                  >
                    Generate video from this script
                  </span>
                </div>
                <div
                  className={cn(
                    "h-px flex-1",
                    kit ? "bg-white/12" : "bg-[var(--ada-border)]",
                  )}
                />
              </div>
              <TextToVideoLauncher
                script={turn.parsedClipPackage.script}
                hooks={turn.parsedClipPackage.hooks}
                generationId={turn.generationId ?? undefined}
                onCreditChange={onTextVideoCreditsRemainingChange}
                variant={kit ? "adaKit" : "default"}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
