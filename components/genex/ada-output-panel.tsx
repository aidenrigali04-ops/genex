"use client";

import type { JSX } from "react";
import { useEffect, useRef } from "react";

import type { ClipSectionMap, HookStrengthSignal } from "@/lib/clip-package";
import {
  CLIP_SECTIONS,
  parseFormatTags,
  parseHookStrengthSignal,
} from "@/lib/clip-package";
import type { GenerationContextV1 } from "@/lib/generation-context";
import { cn } from "@/lib/utils";

import { GenerationFeedbackPanel } from "@/components/generation-feedback-panel";
import { RatingWidget } from "@/components/rating-widget";
import { TextToVideoLauncher } from "@/components/genex/text-to-video-launcher";
import { Sparkles } from "lucide-react";

const SECTION_ACCENT: Record<string, string> = {
  hooks: "#7B5CFA",
  moments: "#22C55E",
  script: "#9B6FFF",
  cta: "#F59E0B",
  creator_signals: "#3B82F6",
  caption_hashtags: "#8B5CF6",
  broll: "#06B6D4",
};

const MAGENTA = "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)]";

export type AdaOutputPanelProps = {
  loading: boolean;
  streamedText: string;
  parsedClipPackage: ClipSectionMap;
  clipFormatTags: string[];
  verticalPreviewText: string;
  copiedId: string | null;
  onCopy: (id: string, body: string) => void | Promise<void>;
  onRegenerate: () => void;
  /** When set, shows Remix next to Regenerate after generation completes. */
  onRemix?: (prompt: string) => void;
  canRegenerate: boolean;
  generationId?: string;
  generationContext: GenerationContextV1 | null;
  originalPrompt: string;
  variant?: "default" | "adaKit";
  onTextVideoCreditsRemainingChange?: (remaining: number) => void;
  /** Single-column chat: wrap output as one assistant message (adaKit bubble chrome). */
  chatEmbedded?: boolean;
  /** Fires once per generation when a high hook-strength signal is shown (parent may trackAha). */
  onHookStrengthRead?: (signal: HookStrengthSignal) => void;
};

export function AdaOutputPanel({
  loading,
  streamedText,
  parsedClipPackage,
  clipFormatTags,
  verticalPreviewText,
  copiedId,
  onCopy,
  onRegenerate,
  onRemix,
  canRegenerate,
  generationId,
  generationContext,
  originalPrompt,
  variant = "default",
  onTextVideoCreditsRemainingChange,
  chatEmbedded = false,
  onHookStrengthRead,
}: AdaOutputPanelProps): JSX.Element | null {
  const kit = variant === "adaKit";
  const showBody = streamedText.trim() || loading;

  const hookSignal = parsedClipPackage.creator_signals
    ? parseHookStrengthSignal(parsedClipPackage.creator_signals)
    : null;

  const tagsFromSignals = parsedClipPackage.creator_signals?.trim()
    ? parseFormatTags(parsedClipPackage.creator_signals)
    : [];
  const derivedFormatTags =
    tagsFromSignals.length > 0 ? tagsFromSignals : clipFormatTags;

  const hookSignalFiredRef = useRef(false);
  const prevGenerationIdRef = useRef<string | undefined>(generationId);

  useEffect(() => {
    if (prevGenerationIdRef.current !== generationId) {
      hookSignalFiredRef.current = false;
      prevGenerationIdRef.current = generationId;
    }
  }, [generationId]);

  useEffect(() => {
    if (loading || !hookSignal || hookSignal.level !== "high") return;
    if (hookSignalFiredRef.current) return;
    hookSignalFiredRef.current = true;
    onHookStrengthRead?.(hookSignal);
  }, [hookSignal, loading, onHookStrengthRead]);

  const regenClass = (embedded: boolean) =>
    cn(
      "shrink-0 rounded-full font-medium transition-colors duration-150 disabled:opacity-40",
      embedded ? "px-3 py-1.5 text-[11px]" : "px-4 py-2 text-xs",
      kit
        ? "border border-white/48 text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/50"
        : "rounded-ada-input border border-ada-border text-ada-secondary hover:border-ada-border-active hover:text-ada-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ada-accent/35",
    );

  const regenerateButton = (embedded: boolean) => (
    <button
      type="button"
      disabled={loading || !canRegenerate}
      onClick={onRegenerate}
      className={regenClass(embedded)}
      style={kit ? { fontWeight: 500 } : undefined}
    >
      Regenerate
    </button>
  );

  const remixButton = (embedded: boolean) =>
    onRemix && !loading && streamedText.trim() ? (
      <button
        type="button"
        aria-label="Remix with this prompt"
        onClick={() => onRemix(originalPrompt)}
        className={cn(
          "shrink-0 rounded-full font-medium transition-colors duration-150",
          embedded ? "px-3 py-1.5 text-[11px]" : "px-4 py-2 text-xs",
          kit
            ? "border border-white/48 text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/50"
            : "rounded-ada-input border border-ada-border text-ada-secondary hover:border-ada-border-active hover:text-ada-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ada-accent/35",
        )}
      >
        Remix
      </button>
    ) : null;

  if (!showBody) {
    if (chatEmbedded) return null;
    return (
      <div
        className={cn(
          "flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed p-8 text-center text-sm",
          kit
            ? "border-white/20 bg-white/4 font-[family-name:var(--font-instrument-sans)] text-white/55"
            : "rounded-ada-card border-ada-border bg-ada-card/50 text-ada-secondary",
        )}
      >
        Output appears here after you generate a clip package.
      </div>
    );
  }

  const titleBlock = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2
        className={cn(
          kit
            ? "font-[family-name:var(--font-instrument-serif)] text-2xl font-normal tracking-[0.36px] text-white"
            : "text-lg font-semibold tracking-tight text-ada-primary",
        )}
      >
        Your clip package
      </h2>
      <div className="flex gap-2">
        {remixButton(false)}
        {regenerateButton(false)}
      </div>
    </div>
  );

  const mergedEmbeddedHeader = (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-b pb-3",
        kit ? "border-white/10" : "border-ada-border",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full shadow-[0_0_18px_rgba(203,45,206,0.28)]",
            kit
              ? "bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)]"
              : "bg-ada-accent shadow-sm",
          )}
        >
          <Sparkles className="size-[18px] text-white" aria-hidden />
        </div>
        <div className="min-w-0">
          <p
            className={cn(
              "text-xs font-medium tracking-wide",
              kit ? "text-[#E8B4FF]" : "font-semibold text-ada-primary",
            )}
          >
            GenEx
          </p>
          <p
            className={cn(
              "truncate text-[11px] font-medium uppercase tracking-widest",
              kit ? "text-white/50" : "text-ada-secondary",
            )}
          >
            Clip package
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {remixButton(true)}
        {regenerateButton(true)}
      </div>
    </div>
  );

  const bodyRest = (
    <>
      {loading && !streamedText.trim() ? (
        <div className="space-y-3">
          {[100, 85, 70, 90, 60].map((w, i) => (
            <div
              key={i}
              className={cn(
                "h-4 animate-pulse rounded-full",
                kit ? "bg-white/15" : "bg-ada-border",
              )}
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex rounded-full px-3 py-1 text-xs font-medium",
                kit
                  ? cn(
                      MAGENTA,
                      "border border-white/10 text-white shadow-[0_0_16px_rgba(203,45,206,0.2)]",
                    )
                  : "rounded-ada-pill border border-ada-accent/35 bg-ada-accent-subtle text-ada-accent-hover",
              )}
            >
              TikTok · Reels · Shorts
            </span>
            {derivedFormatTags.map((tag) => (
              <span
                key={tag}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-medium",
                  kit
                    ? "border border-white/20 bg-white/10 text-white/90"
                    : "rounded-ada-pill border border-ada-border bg-ada-elevated text-ada-primary",
                )}
              >
                {tag}
              </span>
            ))}
          </div>

          {!loading && hookSignal ? (
            <div
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2.5",
                kit
                  ? "border-white/12 bg-white/[0.05]"
                  : "border-ada-border bg-ada-card",
              )}
            >
              <div
                className={cn(
                  "h-2.5 w-2.5 shrink-0 rounded-full",
                  hookSignal.level === "high" && "bg-[var(--ada-success)]",
                  hookSignal.level === "medium" && "bg-[var(--ada-warning)]",
                  hookSignal.level === "low" && "bg-[var(--ada-error)]",
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    "text-xs font-semibold",
                    hookSignal.level === "high" &&
                      (kit ? "text-[color:color-mix(in_srgb,var(--ada-success)_88%,white)]" : "text-[var(--ada-success)]"),
                    hookSignal.level === "medium" &&
                      (kit
                        ? "text-[color:color-mix(in_srgb,var(--ada-warning)_85%,white)]"
                        : "text-[var(--ada-warning)]"),
                    hookSignal.level === "low" &&
                      (kit
                        ? "text-[color:color-mix(in_srgb,var(--ada-error)_85%,white)]"
                        : "text-[var(--ada-error)]"),
                  )}
                >
                  {hookSignal.level === "high"
                    ? "Strong hook"
                    : hookSignal.level === "medium"
                      ? "Decent hook"
                      : "Weak hook — regenerate"}
                </span>
                {hookSignal.reason ? (
                  <span
                    className={cn(
                      "ml-1.5 text-xs",
                      kit ? "text-white/50" : "text-ada-secondary",
                    )}
                  >
                    {hookSignal.reason}
                  </span>
                ) : null}
              </div>
              {hookSignal.level === "low" && canRegenerate ? (
                <button
                  type="button"
                  onClick={onRegenerate}
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                    kit
                      ? "bg-white/10 text-white/80 hover:bg-white/20"
                      : "border border-ada-border text-ada-secondary hover:border-ada-border-active hover:text-ada-primary",
                  )}
                >
                  Try again
                </button>
              ) : null}
            </div>
          ) : null}

          <div
            className={cn(
              "mx-auto w-[min(100%,240px)] rounded-[2rem] p-2",
              kit
                ? "border-2 border-white/15 bg-black/25"
                : "border-4 border-ada-border bg-ada-app",
            )}
          >
            <div
              className={cn(
                "relative aspect-9/16 min-h-[200px] overflow-y-auto rounded-[1.5rem] p-3 text-[12px] leading-snug",
                kit
                  ? "bg-[#12081c]/90 text-white/95 ring-1 ring-white/10"
                  : "bg-ada-sidebar text-ada-primary",
                loading && "genex-shimmer",
              )}
            >
              <p
                className={cn(
                  "mb-2 text-[10px] uppercase tracking-wide",
                  kit ? "text-white/45" : "text-ada-disabled",
                )}
              >
                9:16 preview
              </p>
              <pre className="font-sans whitespace-pre-wrap wrap-break-word">
                {verticalPreviewText.trim()
                  ? verticalPreviewText
                  : loading
                    ? "Streaming…"
                    : "Script appears here."}
              </pre>
            </div>
          </div>

          <div className="grid gap-3">
            {CLIP_SECTIONS.map((section) => {
              const block = parsedClipPackage[section.id];
              const accent = SECTION_ACCENT[section.id] ?? "#7B5CFA";
              return (
                <div
                  key={section.id}
                  className={cn(
                    "overflow-hidden rounded-2xl border transition-colors",
                    kit
                      ? "border-white/14 bg-white/[0.06] backdrop-blur-sm outline -outline-offset-1 outline-white/10 hover:border-white/25"
                      : "rounded-ada-card border-ada-border bg-ada-card hover:border-ada-border-active",
                  )}
                >
                  <div className="h-1 w-full" style={{ background: accent }} />
                  <div className="p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3
                        className={cn(
                          "text-sm font-semibold",
                          kit ? "text-white" : "text-ada-primary",
                        )}
                      >
                        {section.label}
                      </h3>
                      <button
                        type="button"
                        disabled={!block}
                        onClick={() => void onCopy(section.id, block)}
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-xs transition-colors disabled:opacity-30",
                          kit
                            ? "border border-white/28 text-white/80 hover:bg-white/10 hover:text-white"
                            : "rounded-[6px] border border-ada-border text-ada-secondary hover:border-ada-border-active hover:text-ada-primary",
                        )}
                      >
                        {copiedId === section.id ? "✓ Copied" : "Copy"}
                      </button>
                    </div>
                    <pre
                      className={cn(
                        "font-sans text-sm leading-relaxed wrap-break-word whitespace-pre-wrap",
                        kit ? "text-white/90" : "text-ada-primary",
                      )}
                    >
                      {block ||
                        (loading ? (
                          <span
                            className={cn(
                              "animate-pulse",
                              kit ? "text-white/45" : "text-ada-disabled",
                            )}
                          >
                            Generating…
                          </span>
                        ) : (
                          <span
                            className={
                              kit ? "text-white/40" : "text-ada-disabled"
                            }
                          >
                            Content will appear here
                          </span>
                        ))}
                    </pre>
                  </div>
                </div>
              );
            })}
          </div>

          {!loading && streamedText.trim() ? (
            <>
              <div className="space-y-3">
                {parsedClipPackage.script.trim() ? (
                  <details
                    className={cn(
                      "group rounded-xl border",
                      kit
                        ? "border-white/12 bg-white/[0.04]"
                        : "border-ada-border bg-ada-sidebar/80",
                    )}
                  >
                    <summary
                      className={cn(
                        "cursor-pointer px-3 py-2.5 text-sm font-medium marker:content-none [&::-webkit-details-marker]:hidden",
                        kit ? "text-white/90" : "text-ada-primary",
                      )}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Sparkles className="size-4 shrink-0 opacity-70" aria-hidden />
                        Stock video from script (optional)
                        <span className="text-xs font-normal opacity-60 group-open:hidden">
                          — tap to expand
                        </span>
                      </span>
                    </summary>
                    <div
                      className={cn(
                        "border-t px-3 pb-3 pt-2",
                        kit ? "border-white/10" : "border-ada-border",
                      )}
                    >
                      <TextToVideoLauncher
                        script={parsedClipPackage.script}
                        hooks={parsedClipPackage.hooks}
                        generationId={generationId}
                        onCreditChange={onTextVideoCreditsRemainingChange}
                        variant={kit ? "adaKit" : "default"}
                      />
                    </div>
                  </details>
                ) : null}
                <div
                  className={cn(
                    "rounded-xl border px-3 py-2.5",
                    kit
                      ? "border-white/12 bg-white/[0.04]"
                      : "border-ada-border bg-ada-sidebar/80",
                  )}
                >
                  <RatingWidget kind="text" generationId={generationId} />
                </div>
              </div>
              <GenerationFeedbackPanel
                mode="clip"
                variant={kit ? "adaKit" : "default"}
                originalPrompt={originalPrompt || "Clip package"}
                generationContext={generationContext}
                variationsOutput={streamedText}
              />
            </>
          ) : null}
        </>
      )}
    </>
  );

  const embeddedShellClass = kit
    ? "w-full max-w-[min(100%,920px)] space-y-4 rounded-[20px_20px_20px_4px] border border-white/15 bg-white/[0.08] p-4 pb-5 shadow-[0_12px_32px_rgba(0,0,0,0.28)] outline outline-1 -outline-offset-1 outline-white/15"
    : "w-full max-w-[min(100%,920px)] space-y-4 rounded-2xl rounded-bl-md border border-ada-border bg-ada-card p-4 pb-5 shadow-md ring-1 ring-ada-border/30";

  if (chatEmbedded && kit) {
    return (
      <div
        id="output-section"
        className="scroll-mt-6 flex w-full justify-start font-[family-name:var(--font-instrument-sans)] text-white"
      >
        <div className={embeddedShellClass}>
          {mergedEmbeddedHeader}
          {bodyRest}
        </div>
      </div>
    );
  }

  if (chatEmbedded && !kit) {
    return (
      <div
        id="output-section"
        className="scroll-mt-6 flex w-full justify-start text-ada-primary"
      >
        <div className={embeddedShellClass}>
          {mergedEmbeddedHeader}
          {bodyRest}
        </div>
      </div>
    );
  }

  return (
    <div
      id="output-section"
      className={cn(
        "scroll-mt-4 space-y-4",
        kit && "font-[family-name:var(--font-instrument-sans)] text-white",
      )}
    >
      {titleBlock}
      {bodyRest}
    </div>
  );
}
