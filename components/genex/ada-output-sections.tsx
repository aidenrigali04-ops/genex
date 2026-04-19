"use client";

import { Copy } from "lucide-react";

import { CLIP_SECTIONS, type ClipSectionMap } from "@/lib/clip-package";
import { cn } from "@/lib/utils";

const SECTION_ACCENT: Record<string, string> = {
  hooks: "#7B5CFA",
  moments: "#22C55E",
  script: "#9B6FFF",
  cta: "#F59E0B",
  creator_signals: "#3B82F6",
  caption_hashtags: "#8B5CF6",
  broll: "#06B6D4",
};

const SECTION_EMOJI: Record<string, string> = {
  hooks: "⚡",
  moments: "🎬",
  script: "📝",
  cta: "🎯",
  creator_signals: "💡",
  caption_hashtags: "#️⃣",
  broll: "🎥",
};

export type AdaOutputSectionsProps = {
  parsedClipPackage: ClipSectionMap;
  loading: boolean;
  streamedText: string;
  copiedId: string | null;
  onCopy: (id: string, body: string) => void;
  variant?: "default" | "adaKit";
};

export function AdaOutputSections({
  parsedClipPackage,
  loading,
  streamedText,
  copiedId,
  onCopy,
  variant = "default",
}: AdaOutputSectionsProps) {
  const kit = variant === "adaKit";

  if (loading && !streamedText.trim()) {
    return (
      <div className="space-y-2 py-2">
        {[100, 80, 90].map((w, i) => (
          <div
            key={i}
            className={cn(
              "h-3.5 animate-pulse rounded-full",
              kit ? "bg-white/15" : "bg-[var(--ada-border)]",
            )}
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {CLIP_SECTIONS.map((section) => {
        const content = parsedClipPackage[section.id];
        if (!content?.trim()) return null;
        const accent = SECTION_ACCENT[section.id] ?? "#7B5CFA";
        const emoji = SECTION_EMOJI[section.id] ?? "•";

        return (
          <div key={section.id} className="group">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <div
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: accent }}
                />
                <span
                  className="text-xs font-semibold tracking-widest uppercase"
                  style={{ color: accent }}
                >
                  {emoji} {section.label}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void onCopy(section.id, content)}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-[6px] border border-transparent px-2 py-1 text-[10px] opacity-0 transition-all group-hover:opacity-100",
                  kit
                    ? "text-white/50 hover:border-white/20 hover:text-white/80"
                    : "text-[var(--ada-text-disabled)] hover:border-[var(--ada-border)] hover:text-[var(--ada-text-secondary)]",
                )}
              >
                {copiedId === section.id ? "✓" : <Copy className="h-3 w-3" />}
                {copiedId === section.id ? "Copied" : "Copy"}
              </button>
            </div>

            <div
              className={cn(
                "text-sm leading-relaxed whitespace-pre-wrap pl-4",
                kit ? "text-white/95" : "text-[var(--ada-text-primary)]",
                loading
                  ? "border-l-2 border-dashed py-0.5"
                  : "rounded-r-lg border py-2 pr-2",
              )}
              style={{
                borderColor: loading ? `${accent}40` : `${accent}28`,
                backgroundColor: loading ? "transparent" : `${accent}08`,
              }}
            >
              {content}
              {loading ? (
                <span
                  className={cn(
                    "ml-0.5 inline-block h-4 w-0.5 animate-pulse",
                    kit ? "bg-white/70" : "bg-[var(--ada-accent)]",
                  )}
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
