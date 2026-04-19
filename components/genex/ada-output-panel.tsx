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
}: AdaOutputPanelProps) {
  const showBody = streamedText.trim() || loading;

  if (!showBody) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-ada-card border border-dashed border-ada-border bg-ada-card/50 p-8 text-center text-sm text-ada-secondary">
        Output appears here after you generate a clip package.
      </div>
    );
  }

  return (
    <div id="output-section" className="scroll-mt-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-ada-primary">Your clip package</h2>
        <button
          type="button"
          disabled={loading || !canRegenerate}
          onClick={onRegenerate}
          className="rounded-ada-input border border-ada-border px-3 py-1.5 text-xs font-medium text-ada-secondary transition-colors hover:border-ada-border-active hover:text-ada-primary disabled:opacity-40"
        >
          Regenerate
        </button>
      </div>

      {loading && !streamedText.trim() ? (
        <div className="space-y-3">
          {[100, 85, 70, 90, 60].map((w, i) => (
            <div
              key={i}
              className="h-4 animate-pulse rounded-full bg-ada-border"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-ada-pill border border-ada-accent/35 bg-ada-accent-subtle px-3 py-1 text-xs font-medium text-ada-accent-hover">
              TikTok · Reels · Shorts
            </span>
            {clipFormatTags.map((tag) => (
              <span
                key={tag}
                className="rounded-ada-pill border border-ada-border bg-ada-elevated px-2.5 py-0.5 text-xs font-medium text-ada-primary"
              >
                {tag}
              </span>
            ))}
          </div>

          <div className="mx-auto w-[min(100%,240px)] rounded-[2rem] border-4 border-ada-border bg-ada-app p-2">
            <div
              className={cn(
                "relative aspect-9/16 min-h-[200px] overflow-y-auto rounded-[1.5rem] bg-ada-sidebar p-3 text-[12px] leading-snug text-ada-primary",
                loading && "genex-shimmer",
              )}
            >
              <p className="mb-2 text-[10px] uppercase tracking-wide text-ada-disabled">
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
                  className="overflow-hidden rounded-ada-card border border-ada-border bg-ada-card transition-colors hover:border-ada-border-active"
                >
                  <div className="h-1 w-full" style={{ background: accent }} />
                  <div className="p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-ada-primary">{section.label}</h3>
                      <button
                        type="button"
                        disabled={!block}
                        onClick={() => void onCopy(section.id, block)}
                        className="rounded-[6px] border border-ada-border px-2.5 py-1 text-xs text-ada-secondary transition-colors hover:border-ada-border-active hover:text-ada-primary disabled:opacity-30"
                      >
                        {copiedId === section.id ? "✓ Copied" : "Copy"}
                      </button>
                    </div>
                    <pre className="font-sans text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-ada-primary">
                      {block ||
                        (loading ? (
                          <span className="animate-pulse text-ada-disabled">Generating…</span>
                        ) : (
                          <span className="text-ada-disabled">Content will appear here</span>
                        ))}
                    </pre>
                  </div>
                </div>
              );
            })}
          </div>

          {!loading && streamedText.trim() ? (
            <>
              <div className="rounded-ada-card border border-ada-border bg-ada-sidebar px-4 py-3">
                <RatingWidget kind="text" generationId={generationId} />
              </div>
              <GenerationFeedbackPanel
                mode="clip"
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
