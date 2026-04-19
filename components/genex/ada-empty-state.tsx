"use client";

import type { JSX } from "react";
import { useEffect, useState } from "react";
import { Zap } from "lucide-react";

import { AdaOutputScroll } from "@/components/genex/ada-output-scroll";
import { cn } from "@/lib/utils";

const PROMPT_CARDS: {
  icon: string;
  label: string;
  sublabel: string;
  prompt: string;
  mode: "text" | "url";
}[] = [
  {
    icon: "⚡",
    label: "Viral hook formula",
    sublabel: "Idea → hooks + script",
    prompt:
      "Most people waste their first hour every morning. Here is how I fixed mine in 7 days and gained 40K followers from one video.",
    mode: "text",
  },
  {
    icon: "🎬",
    label: "YouTube → 3 clips",
    sublabel: "Paste a link, get clip packages",
    prompt: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    mode: "url",
  },
  {
    icon: "🔥",
    label: "Contrarian take",
    sublabel: "Opinion → viral angle",
    prompt:
      "Posting every day is the worst advice on social media. Here is what actually grows your account faster.",
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
  isAuthenticated?: boolean;
  hasGenerated?: boolean;
};

export function AdaEmptyState({
  onExampleClick,
  onPreferIdeaFirst,
  variant = "default",
  isAuthenticated = false,
  hasGenerated = false,
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

  const displayCount =
    generationTotal != null && generationTotal > 10
      ? smoothSocialProofCount(generationTotal)
      : 1000;

  const showProgress = isAuthenticated === true && hasGenerated === false;

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

      {showProgress ? (
        <div className="w-full max-w-sm space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className={kit ? "text-white/50" : "text-ada-secondary"}>
              Getting started
            </span>
            <span
              className={
                kit ? "font-medium text-white/70" : "font-medium text-ada-primary"
              }
            >
              Step 1 of 3
            </span>
          </div>
          <div
            className={cn(
              "h-1.5 w-full overflow-hidden rounded-full",
              kit ? "bg-white/10" : "bg-ada-border",
            )}
          >
            <div
              className="h-full rounded-full bg-[var(--ada-accent)] transition-all duration-700 ease-out"
              style={{ width: "33%" }}
            />
          </div>
          <p
            className={cn(
              "text-[10px]",
              kit ? "text-white/40" : "text-ada-disabled",
            )}
          >
            ✓ Account created · Generate your first clip package · Remix it
          </p>
        </div>
      ) : null}

      <div className="-mx-4 w-[calc(100%+2rem)] max-w-none sm:mx-0 sm:w-full">
        <AdaOutputScroll variant={variant} />
      </div>

      <div className="space-y-2">
        <h2
          className={cn(
            "text-2xl font-semibold",
            kit ? "text-white" : "text-[var(--ada-text-primary)]",
          )}
        >
          Got an idea? You&apos;re one paste away from going viral.
        </h2>
        <p
          className={cn(
            "mx-auto max-w-md text-sm",
            kit ? "text-white/60" : "text-[var(--ada-text-secondary)]",
          )}
        >
          Drop a YouTube link, a transcript, or a raw idea — GenEx writes your
          hooks, script, B-roll, and captions in seconds.
        </p>
        <p
          className={cn(
            "mx-auto max-w-md text-xs",
            kit ? "text-white/40" : "text-[var(--ada-text-disabled)]",
          )}
        >
          {displayCount.toLocaleString()}+ clip packages created by creators like
          you
        </p>
      </div>

      <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-3">
        {PROMPT_CARDS.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => onExampleClick(ex.prompt, ex.mode)}
            className={cn(
              "group/card flex items-start gap-3 rounded-[12px] border p-4 text-left transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]",
              kit
                ? "border-white/14 bg-white/[0.06] hover:border-white/28 hover:bg-white/[0.1]"
                : "border-[var(--ada-border)] bg-[var(--ada-bg-card)] hover:border-[var(--ada-border-active)] hover:bg-[var(--ada-bg-card-hover)]",
            )}
          >
            <span className="text-2xl">{ex.icon}</span>
            <div className="min-w-0">
              <p
                className={cn(
                  "text-sm font-semibold",
                  kit ? "text-white" : "text-[var(--ada-text-primary)]",
                )}
              >
                {ex.label}
              </p>
              <p
                className={cn(
                  "mt-0.5 text-xs",
                  kit ? "text-white/45" : "text-[var(--ada-text-disabled)]",
                )}
              >
                {ex.sublabel}
              </p>
            </div>
          </button>
        ))}
      </div>

      {onPreferIdeaFirst ? (
        <button
          type="button"
          onClick={() => onPreferIdeaFirst()}
          className={cn(
            "group text-sm underline-offset-4 transition-colors hover:underline",
            kit ? "text-white/50 hover:text-white/75" : "text-[var(--ada-text-secondary)] hover:text-[var(--ada-text-primary)]",
          )}
        >
          Start from a raw idea{" "}
          <span className="inline-block transition-transform duration-150 group-hover:translate-x-0.5">
            →
          </span>
        </button>
      ) : null}
    </div>
  );
}
