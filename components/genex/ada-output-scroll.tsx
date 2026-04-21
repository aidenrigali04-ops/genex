"use client";

import type { JSX } from "react";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

export type AdaOutputScrollProps = {
  variant?: "default" | "adaKit";
};

type SectionKind = "Hook" | "Script" | "CTA";

type Snippet = { section: SectionKind; text: string };

const ROW1: Snippet[] = [
  {
    section: "Hook",
    text: "POV: You spent 3 years learning this so you didn't have to.",
  },
  {
    section: "Script",
    text: "Here's the thing nobody tells you about going viral on TikTok the first time.",
  },
  {
    section: "Hook",
    text: "I tried every morning routine on YouTube. This is the only one that actually worked.",
  },
  {
    section: "CTA",
    text: "Follow for the full breakdown — dropping tomorrow.",
  },
  {
    section: "Hook",
    text: "The algorithm isn't random. Here's exactly how it decides to push your video.",
  },
  {
    section: "Script",
    text: "Stop making 60-second videos. The sweet spot right now is 23 seconds. Here's why.",
  },
];

const ROW2: Snippet[] = [
  {
    section: "Hook",
    text: "Nobody talks about the editing trick that 10x'd my views overnight.",
  },
  {
    section: "CTA",
    text: "Save this. You'll want it when you're stuck on your next hook.",
  },
  {
    section: "Script",
    text: "Three things I wish I knew before I posted my first Reel.",
  },
  {
    section: "Hook",
    text: "This 8-second hook format is responsible for 4 of my last 5 viral videos.",
  },
  {
    section: "Script",
    text: "Most creators quit at 1,000 followers. Here's what happens if you don't.",
  },
  {
    section: "CTA",
    text: "Comment the word 'CLIPS' and I'll DM you the full checklist.",
  },
];

const MASK =
  "linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)";

const REDUCE_MOTION_MQ = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onStoreChange: () => void): () => void {
  const mq = window.matchMedia(REDUCE_MOTION_MQ);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot(): boolean {
  return window.matchMedia(REDUCE_MOTION_MQ).matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
}

function SectionChip({ section }: { section: SectionKind }): JSX.Element {
  const base =
    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white";
  if (section === "Hook") {
    return (
      <span className={cn(base, "bg-[var(--ada-accent)]")} aria-hidden>
        Hook
      </span>
    );
  }
  if (section === "Script") {
    return (
      <span
        className={cn(base, "bg-[var(--ada-success)]")}
        aria-hidden
      >
        Script
      </span>
    );
  }
  return (
    <span className={cn(base, "bg-[var(--ada-warning)]")} aria-hidden>
      CTA
    </span>
  );
}

function SnippetPill({
  snippet,
  kit,
}: {
  snippet: Snippet;
  kit: boolean;
}): JSX.Element {
  return (
    <div
      className={cn(
        "flex max-w-[min(90vw,520px)] shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm",
        kit
          ? "border border-white/14 bg-white/[0.07] text-white/90"
          : "border border-ada-border bg-ada-card text-ada-primary",
      )}
    >
      <SectionChip section={snippet.section} />
      <span className="min-w-0 truncate text-left">
        <span className="sr-only">{snippet.section}: </span>
        {snippet.text}
      </span>
    </div>
  );
}

function MarqueeRow({
  snippets,
  direction,
  kit,
}: {
  snippets: Snippet[];
  direction: "left" | "right";
  kit: boolean;
}): JSX.Element {
  const animClass =
    direction === "left"
      ? "animate-genex-marquee-left"
      : "animate-genex-marquee-right";

  return (
    <div
      className={cn(
        "overflow-hidden py-1",
        direction === "left" ? "group/row1" : "group/row2",
      )}
      style={{
        maskImage: MASK,
        WebkitMaskImage: MASK,
      }}
    >
      <div
        className={cn(
          "flex w-max gap-3",
          animClass,
          direction === "left"
            ? "group-hover/row1:[animation-play-state:paused]"
            : "group-hover/row2:[animation-play-state:paused]",
        )}
      >
        {snippets.map((s, i) => (
          <SnippetPill key={`a-${i}`} snippet={s} kit={kit} />
        ))}
        {snippets.map((s, i) => (
          <SnippetPill key={`b-${i}`} snippet={s} kit={kit} />
        ))}
      </div>
    </div>
  );
}

function StaticPreview({ kit }: { kit: boolean }): JSX.Element {
  const four = [...ROW1.slice(0, 2), ...ROW2.slice(0, 2)];
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {four.map((s) => (
        <SnippetPill key={s.text} snippet={s} kit={kit} />
      ))}
    </div>
  );
}

export function AdaOutputScroll({
  variant = "default",
}: AdaOutputScrollProps): JSX.Element {
  const kit = variant === "adaKit";
  const reduceMotion = usePrefersReducedMotion();

  return (
    <div
      className="w-full space-y-2"
      aria-label="Example hooks and scripts from real clip packages"
    >
      {reduceMotion ? (
        <StaticPreview kit={kit} />
      ) : (
        <>
          <MarqueeRow snippets={ROW1} direction="left" kit={kit} />
          <MarqueeRow snippets={ROW2} direction="right" kit={kit} />
        </>
      )}
    </div>
  );
}
