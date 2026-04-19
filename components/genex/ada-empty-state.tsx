"use client";

import type { JSX } from "react";
import { useEffect, useState } from "react";
import { Zap } from "lucide-react";

import { cn } from "@/lib/utils";

const EXAMPLES: {
  icon: string;
  label: string;
  prompt: string;
  mode: "text" | "url";
}[] = [
  {
    icon: "🎬",
    label: "YouTube video → 3 viral clips",
    prompt: "https://youtube.com/watch?v=dQw4w9WgXcQ",
    mode: "url",
  },
  {
    icon: "🎙",
    label: "Podcast episode → post-ready shorts",
    prompt: "https://youtube.com/watch?v=jNQXAC9IVRw",
    mode: "url",
  },
  {
    icon: "💡",
    label: "Raw idea → full script + captions",
    prompt:
      "Most people waste their first hour every morning. Here is how I fixed mine in 7 days.",
    mode: "text",
  },
];

function smoothSocialProofCount(n: number): number {
  return Math.floor(n / 10) * 10;
}

export type AdaEmptyStateProps = {
  onExampleClick: (prompt: string, mode: "text" | "url") => void;
  /** Switch to idea-first flow without picking an example card. */
  onPreferIdeaFirst?: () => void;
  variant?: "default" | "adaKit";
};

export function AdaEmptyState({
  onExampleClick,
  onPreferIdeaFirst,
  variant = "default",
}: AdaEmptyStateProps): JSX.Element {
  const kit = variant === "adaKit";
  const [generationTotal, setGenerationTotal] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/stats/generation-total", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok) return;
        const j = (await res.json()) as { count?: unknown };
        const c = typeof j.count === "number" ? j.count : 0;
        if (!cancelled) setGenerationTotal(c);
      } catch {
        /* omit counter */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const roundedTotal =
    generationTotal != null ? smoothSocialProofCount(generationTotal) : 0;
  const showSocial =
    generationTotal != null &&
    generationTotal > 10 &&
    roundedTotal > 0;

  return (
    <div
      className={cn(
        "flex min-h-[60vh] flex-col items-center justify-center space-y-8 px-4 text-center",
        kit && "text-white",
      )}
    >
      <div
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-[16px] shadow-xl",
          kit
            ? "bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] shadow-[#8800DC33]"
            : "bg-gradient-to-br from-[#7B5CFA] to-[#9B6FFF] shadow-[#7B5CFA33]",
        )}
      >
        <Zap className="h-7 w-7 text-white" aria-hidden />
      </div>

      <div className="space-y-2">
        <h2
          className={cn(
            "text-2xl font-semibold",
            kit ? "text-white" : "text-[var(--ada-text-primary)]",
          )}
        >
          Your best clips are already in that video.
        </h2>
        <p
          className={cn(
            "mx-auto max-w-md text-sm",
            kit ? "text-white/60" : "text-[var(--ada-text-secondary)]",
          )}
        >
          Paste a YouTube link — GenEx finds them and makes them post-ready.
        </p>
        {showSocial ? (
          <p
            className={cn(
              "mx-auto max-w-md text-xs",
              kit ? "text-white/40" : "text-[var(--ada-text-disabled)]",
            )}
          >
            {roundedTotal}+ clip packages created
          </p>
        ) : null}
      </div>

      {onPreferIdeaFirst ? (
        <button
          type="button"
          onClick={() => onPreferIdeaFirst()}
          className={cn(
            "text-sm underline-offset-4 transition-colors hover:underline",
            kit ? "text-white/50 hover:text-white/75" : "text-[var(--ada-text-secondary)] hover:text-[var(--ada-text-primary)]",
          )}
        >
          Or start from a raw idea →
        </button>
      ) : null}

      <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-3">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => onExampleClick(ex.prompt, ex.mode)}
            className={cn(
              "group flex items-start gap-3 rounded-[12px] border p-4 text-left transition-all active:scale-[0.98]",
              kit
                ? "border-white/14 bg-white/[0.06] hover:border-white/28 hover:bg-white/[0.1]"
                : "border-[var(--ada-border)] bg-[var(--ada-bg-card)] hover:border-[var(--ada-border-active)] hover:bg-[var(--ada-bg-card-hover)]",
            )}
          >
            <span className="text-lg">{ex.icon}</span>
            <div className="min-w-0">
              <p
                className={cn(
                  "text-sm font-medium",
                  kit ? "text-white" : "text-[var(--ada-text-primary)]",
                )}
              >
                {ex.label}
              </p>
              <p
                className={cn(
                  "mt-0.5 line-clamp-2 text-xs",
                  kit
                    ? "text-white/45 group-hover:text-white/70"
                    : "text-[var(--ada-text-disabled)] group-hover:text-[var(--ada-text-secondary)]",
                )}
              >
                {ex.prompt.length > 60 ? `${ex.prompt.slice(0, 60)}…` : ex.prompt}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
