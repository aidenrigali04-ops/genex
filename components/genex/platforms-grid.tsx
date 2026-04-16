"use client";

import { cn } from "@/lib/utils";

const PLATFORMS = [
  { name: "TikTok", tone: "Hooks & pacing" },
  { name: "Instagram Reels", tone: "Visual rhythm" },
  { name: "YouTube Shorts", tone: "Retention arcs" },
  { name: "CapCut", tone: "Edit-ready beats" },
  { name: "Notion", tone: "Script → outline" },
  { name: "Slack", tone: "Team handoff" },
];

export function PlatformsGrid({ className }: { className?: string }) {
  return (
    <section
      id="features"
      className={cn("scroll-mt-24 py-16 dark:border-white/10", className)}
    >
      <div className="mx-auto max-w-6xl px-4">
        <h2 className="text-center text-2xl font-bold tracking-tight text-[#0F0A1E] sm:text-3xl dark:text-white">
          Built for your stack
        </h2>
        <p className="text-muted-foreground mx-auto mt-3 max-w-2xl text-center text-sm sm:text-base">
          Genex outputs are tuned for where short-form actually ships.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORMS.map((p) => (
            <div
              key={p.name}
              className="group rounded-2xl border border-[#E8E4F8] bg-white p-5 shadow-sm transition duration-200 hover:scale-[1.02] hover:border-[#C4BAF0] hover:shadow-md dark:border-white/10 dark:bg-zinc-900 dark:hover:border-violet-500/30"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-semibold text-[#0F0A1E] dark:text-white">
                  {p.name}
                </span>
                <span className="rounded-full bg-[#F0EFFE] px-2.5 py-0.5 text-xs font-medium text-[#6C47FF] dark:bg-violet-950/60 dark:text-violet-200">
                  Integration
                </span>
              </div>
              <p className="text-muted-foreground mt-2 text-sm">{p.tone}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
