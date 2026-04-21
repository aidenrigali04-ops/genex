"use client";

import { useMemo } from "react";
import { Copy, Link2, Paperclip, Zap } from "lucide-react";

import { AdaOutputPanel } from "@/components/genex/ada-output-panel";
import {
  CLIP_SECTIONS,
  parseFormatTags,
  type ClipSectionMap,
} from "@/lib/clip-package";
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

function verticalPreviewFromPackage(pkg: ClipSectionMap): string {
  const hooks = pkg.hooks?.trim() ?? "";
  const script = pkg.script?.trim() ?? "";
  const parts = [hooks, script].filter(Boolean);
  return parts.join("\n\n").slice(0, 6000);
}

export type AdaTurnProps = {
  turn: ClipTurn;
  isLast: boolean;
  copiedId: string | null;
  onCopy: (id: string, body: string) => void | Promise<void>;
  onRegenerate: () => void;
  /** Prefill composer with the original prompt (Remix). */
  onRemix?: (prompt: string) => void;
  onTextVideoCreditsRemainingChange?: (remaining: number) => void;
  variant?: "default" | "adaKit";
};

export function AdaTurn({
  turn,
  isLast,
  copiedId,
  onCopy,
  onRegenerate,
  onRemix,
  onTextVideoCreditsRemainingChange,
  variant = "default",
}: AdaTurnProps) {
  const kit = variant === "adaKit";

  const clipFormatTags = useMemo(
    () => parseFormatTags(turn.parsedClipPackage.creator_signals?.trim() ?? ""),
    [turn.parsedClipPackage.creator_signals],
  );

  const verticalPreviewText = useMemo(
    () => verticalPreviewFromPackage(turn.parsedClipPackage),
    [turn.parsedClipPackage],
  );

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

          <div
            className={cn(
              "mt-1.5 flex flex-wrap items-center justify-end gap-2 text-right text-[10px]",
              kit ? "text-white/45" : "text-[var(--ada-text-disabled)]",
            )}
            suppressHydrationWarning
          >
            {turn.isRestored ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 font-medium tracking-wide uppercase",
                  kit
                    ? "bg-white/15 text-white/90"
                    : "bg-[var(--ada-accent)]/15 text-[var(--ada-accent-hover)]",
                )}
              >
                Restored
              </span>
            ) : null}
            <span>{formatRelativeTime(turn.timestamp)}</span>
          </div>
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
          {isLast ? (
            <>
              <AdaOutputPanel
                loading={false}
                streamedText={turn.rawText}
                parsedClipPackage={turn.parsedClipPackage}
                clipFormatTags={clipFormatTags}
                verticalPreviewText={verticalPreviewText}
                copiedId={copiedId}
                onCopy={onCopy}
                onRegenerate={onRegenerate}
                onRemix={onRemix}
                canRegenerate
                generationId={turn.generationId ?? undefined}
                generationContext={turn.generationContext}
                originalPrompt={turn.userMessage || ""}
                variant={variant}
                onTextVideoCreditsRemainingChange={onTextVideoCreditsRemainingChange}
              />
              <div className="flex flex-wrap items-center gap-2 pt-1">
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
                  <Copy className="h-3 w-3" aria-hidden />
                  Copy all
                </button>
              </div>
            </>
          ) : (
            <AdaOutputSections
              parsedClipPackage={turn.parsedClipPackage}
              copiedId={copiedId}
              loading={false}
              streamedText={turn.rawText}
              onCopy={onCopy}
              variant={variant}
            />
          )}
        </div>
      </div>
    </div>
  );
}
