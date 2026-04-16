"use client";

import { cn } from "@/lib/utils";

export type HeroProps = {
  className?: string;
  isSignedIn: boolean;
  onPrimaryCta: () => void;
};

export function Hero({ className, isSignedIn, onPrimaryCta }: HeroProps) {
  return (
    <section
      className={cn(
        "relative overflow-hidden border-b border-[#E8E4F8] dark:border-white/10",
        className,
      )}
    >
      <div className="genex-dot-grid relative mx-auto max-w-6xl px-4 py-16 sm:py-20 lg:py-24">
        <div
          className="pointer-events-none absolute -right-24 top-0 size-[320px] rounded-full bg-[#6C47FF]/20 blur-3xl sm:size-[420px]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -left-20 bottom-0 size-[280px] rounded-full bg-[#C4BAF0]/30 blur-3xl"
          aria-hidden
        />

        <div className="relative z-[1] mx-auto max-w-3xl text-center genex-hero-fade">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-[#0F0A1E] sm:text-5xl lg:text-[3.25rem] dark:text-white">
            Create{" "}
            <span className="genex-gradient-word-1">Viral</span>{" "}
            <span className="genex-gradient-word-2">Short-Form</span>{" "}
            <span className="genex-gradient-word-3">Clips</span>
            <br />
            in seconds
          </h1>
          <p className="text-muted-foreground mx-auto mt-4 max-w-xl text-base sm:text-lg">
            Upload a video or paste a URL, describe your edit, and get
            ready-to-post variations for TikTok, Reels, and Shorts.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6">
            <button
              type="button"
              onClick={onPrimaryCta}
              className="inline-flex h-12 min-w-[200px] items-center justify-center rounded-full bg-[#6C47FF] px-8 text-base font-semibold text-white shadow-md transition hover:bg-[#5835E8] genex-cta-glow"
            >
              {isSignedIn ? "Open workspace" : "Start free"}
            </button>
            <div className="flex items-center gap-3 text-sm text-[#6B6B8A] dark:text-zinc-400">
              <div className="flex -space-x-2">
                {["from-violet-400 to-purple-500", "from-amber-400 to-orange-500", "from-sky-400 to-blue-500"].map(
                  (g, i) => (
                    <span
                      key={i}
                      className={cn(
                        "inline-flex size-9 rounded-full border-2 border-white bg-gradient-to-br ring-1 ring-[#E8E4F8] dark:border-zinc-900 dark:ring-white/10",
                        g,
                      )}
                      aria-hidden
                    />
                  ),
                )}
              </div>
              <span className="max-w-[14rem] text-left font-medium text-[#0F0A1E]/80 dark:text-zinc-200">
                1,200+ creators ship faster with Genex
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
