"use client";

import type { ClipSectionMap } from "@/lib/clip-package";
import { CLIP_SECTIONS } from "@/lib/clip-package";
import type { GenerationContextV1 } from "@/lib/generation-context";
import { cn } from "@/lib/utils";

import { GenerationFeedbackPanel } from "@/components/generation-feedback-panel";
import { RatingWidget } from "@/components/rating-widget";

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
  onCopy: (id: string, body: string) => void;
  onRegenerate: () => void;
  canRegenerate: boolean;
  generationId?: string;
  generationContext: GenerationContextV1 | null;
  originalPrompt: string;
  variant?: "default" | "adaKit";
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
  canRegenerate,
  generationId,
  generationContext,
  originalPrompt,
  variant = "default",
}: AdaOutputPanelProps) {
  const kit = variant === "adaKit";
  const showBody = streamedText.trim() || loading;

  if (!showBody) {
    return (
      <div
        className={cn(
          "flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed p-8 text-center text-sm",
          kit
            ? "border-white/20 bg-white/[0.04] font-[family-name:var(--font-instrument-sans)] text-white/55"
            : "rounded-ada-card border-ada-border bg-ada-card/50 text-ada-secondary",
        )}
      >
        Output appears here after you generate a clip package.
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
        <button
          type="button"
          disabled={loading || !canRegenerate}
          onClick={onRegenerate}
          className={cn(
            "rounded-full px-4 py-2 text-xs font-medium transition-colors disabled:opacity-40",
            kit
              ? "border border-white/48 text-white hover:bg-white/10"
              : "rounded-ada-input border border-ada-border text-ada-secondary hover:border-ada-border-active hover:text-ada-primary",
          )}
          style={kit ? { fontWeight: 500 } : undefined}
        >
          Regenerate
        </button>
      </div>

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
                  ? cn(MAGENTA, "border border-white/10 text-white shadow-[0_0_16px_rgba(203,45,206,0.2)]")
                  : "rounded-ada-pill border border-ada-accent/35 bg-ada-accent-subtle text-ada-accent-hover",
              )}
            >
              TikTok · Reels · Shorts
            </span>
            {clipFormatTags.map((tag) => (
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

          <div
            className={cn(
              "mx-auto w-[min(100%,240px)] rounded-[2rem] p-2",
              kit ? "border-2 border-white/15 bg-black/25" : "border-4 border-ada-border bg-ada-app",
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
                      ? "border-white/14 bg-white/[0.06] backdrop-blur-sm outline outline-1 -outline-offset-1 outline-white/10 hover:border-white/25"
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
                          <span className={kit ? "text-white/40" : "text-ada-disabled"}>
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
              <div
                className={cn(
                  "rounded-2xl border px-4 py-3",
                  kit
                    ? "border-white/14 bg-white/[0.05] backdrop-blur-sm"
                    : "rounded-ada-card border-ada-border bg-ada-sidebar",
                )}
              >
                <RatingWidget kind="text" generationId={generationId} />
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
    </div>
  );
}
