"use client";

import type { JSX } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Copy } from "lucide-react";

import { trackAha, type AhaEvent } from "@/lib/analytics";
import {
  CLIP_SECTIONS,
  parseHookStrength,
  type ClipSectionMap,
  type HookStrengthResult,
} from "@/lib/clip-package";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const SECTION_ACCENT: Record<string, string> = {
  hooks: "var(--ada-accent)",
  moments: "var(--ada-success)",
  script: "var(--ada-accent-hover)",
  cta: "var(--ada-warning)",
  creator_signals: "var(--ada-border-focus)",
  caption_hashtags: "var(--ada-accent)",
  broll: "var(--ada-border-active)",
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

const STRENGTH_CONFIG = {
  high: {
    emoji: "🔥",
    label: "High-hook potential",
    color: "var(--ada-accent)",
  },
  strong: {
    emoji: "⚡",
    label: "Strong opener",
    color: "var(--ada-accent-hover)",
  },
  solid: {
    emoji: "✓",
    label: "Solid hook",
    color: "var(--ada-text-secondary)",
  },
} as const;

function HookStrengthBadge({
  result,
}: {
  result: HookStrengthResult;
}): JSX.Element {
  const cfg = STRENGTH_CONFIG[result.strength];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-widest"
      style={{
        color: cfg.color,
        border: `1px solid ${cfg.color}`,
        opacity: 0.85,
      }}
      title={result.reason}
    >
      {cfg.emoji} {cfg.label}
    </span>
  );
}

function copyEventForSection(sectionId: string): AhaEvent | null {
  switch (sectionId) {
    case "hooks":
      return "copy_hook";
    case "caption_hashtags":
      return "copy_caption";
    case "script":
      return "copy_script";
    default:
      return null;
  }
}

export type AdaOutputSectionsProps = {
  parsedClipPackage: ClipSectionMap;
  loading: boolean;
  streamedText: string;
  copiedId: string | null;
  onCopy: (id: string, body: string) => void | Promise<void>;
  variant?: "default" | "adaKit";
};

export function AdaOutputSections({
  parsedClipPackage,
  loading,
  streamedText,
  copiedId,
  onCopy,
  variant = "default",
}: AdaOutputSectionsProps): JSX.Element {
  const kit = variant === "adaKit";
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [sectionCopiedId, setSectionCopiedId] = useState<string | null>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setUserId(data.user?.id ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
    };
  }, []);

  const hookStrengthResult = useMemo(
    () => parseHookStrength(parsedClipPackage.creator_signals ?? ""),
    [parsedClipPackage.creator_signals],
  );

  const visibleSections = useMemo(
    () =>
      CLIP_SECTIONS.filter((s) => parsedClipPackage[s.id]?.trim()?.length),
    [parsedClipPackage],
  );

  if (loading && !streamedText.trim()) {
    return (
      <div className="space-y-2 py-2">
        {[100, 80, 90].map((w, i) => (
          <div
            key={i}
            className={cn(
              "h-3.5 animate-pulse rounded-full",
              kit ? "bg-white/15" : "bg-ada-border",
            )}
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {visibleSections.map((section, index) => {
        const content = parsedClipPackage[section.id];
        if (!content?.trim()) return null;
        const accent = SECTION_ACCENT[section.id] ?? "var(--ada-accent)";
        const emoji = SECTION_EMOJI[section.id] ?? "•";
        const isCopied =
          sectionCopiedId === section.id || copiedId === section.id;

        const handleCopy = (): void => {
          void (async () => {
            try {
              await Promise.resolve(onCopy(section.id, content));
            } catch {
              return;
            }
            if (copyResetTimerRef.current) {
              clearTimeout(copyResetTimerRef.current);
            }
            setSectionCopiedId(section.id);
            copyResetTimerRef.current = setTimeout(() => {
              setSectionCopiedId(null);
              copyResetTimerRef.current = null;
            }, 2000);
            const evt = copyEventForSection(section.id);
            if (evt && userId) {
              void trackAha(supabase, userId, evt);
            }
          })();
        };

        return (
          <div
            key={section.id}
            className="group animate-fadeIn"
            style={{
              animationDelay: `${index * 80}ms`,
              animationFillMode: "both",
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                {section.id === "hooks" && hookStrengthResult ? (
                  <HookStrengthBadge result={hookStrengthResult} />
                ) : null}
              </div>
              <button
                type="button"
                onClick={handleCopy}
                aria-label={isCopied ? "Copied to clipboard" : `Copy ${section.label}`}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-[6px] border border-transparent px-2 py-1 text-[10px] opacity-0 transition-all group-hover:opacity-100",
                  kit
                    ? "text-white/50 hover:border-white/20 hover:text-white/80"
                    : "text-[var(--ada-text-disabled)] hover:border-[var(--ada-border)] hover:text-[var(--ada-text-secondary)]",
                )}
              >
                {isCopied ? (
                  <span aria-hidden>✓ Copied</span>
                ) : (
                  <>
                    <Copy className="h-3 w-3" aria-hidden />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>

            <div
              className={cn(
                "text-sm leading-relaxed whitespace-pre-wrap pl-4",
                kit ? "text-white/95" : "text-[var(--ada-text-primary)]",
                loading
                  ? kit
                    ? "border-l-2 border-dashed border-white/30 py-0.5"
                    : "border-l-2 border-dashed border-[var(--ada-accent)]/35 py-0.5"
                  : kit
                    ? "rounded-r-lg border border-white/15 bg-white/[0.06] py-2 pr-2"
                    : "rounded-r-lg border border-[var(--ada-border)] bg-[var(--ada-accent-subtle)] py-2 pr-2",
              )}
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
