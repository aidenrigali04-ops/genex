"use client";

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
    label: "YouTube → Reels",
    prompt: "https://youtube.com/watch?v=dQw4w9WgXcQ",
    mode: "url",
  },
  {
    icon: "⚡",
    label: "Hook from idea",
    prompt:
      "Most people waste their first hour every morning. Here is how I fixed mine in 7 days.",
    mode: "text",
  },
  {
    icon: "🔥",
    label: "Contrarian take",
    prompt: "Hustle culture is broken and here is the data to prove it.",
    mode: "text",
  },
  {
    icon: "📖",
    label: "Story structure",
    prompt:
      "I lost everything at 27 and rebuilt from zero. This is exactly what I did.",
    mode: "text",
  },
];

export type AdaEmptyStateProps = {
  onExampleClick: (prompt: string, mode: "text" | "url") => void;
  variant?: "default" | "adaKit";
};

export function AdaEmptyState({
  onExampleClick,
  variant = "default",
}: AdaEmptyStateProps) {
  const kit = variant === "adaKit";

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
          What are we creating today?
        </h2>
        <p
          className={cn(
            "mx-auto max-w-sm text-sm",
            kit ? "text-white/60" : "text-[var(--ada-text-secondary)]",
          )}
        >
          Drop a YouTube URL, paste your transcript, or type an idea. GenEx turns
          it into clips ready for TikTok, Reels, and Shorts.
        </p>
      </div>

      <div className="grid w-full max-w-lg grid-cols-2 gap-2">
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
