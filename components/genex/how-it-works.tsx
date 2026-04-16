"use client";

import { Film, Sparkles, Upload } from "lucide-react";

import { cn } from "@/lib/utils";

const STEPS = [
  {
    icon: Upload,
    title: "Add your source",
    body: "Drop a file, paste a YouTube link, or write a rough idea — we handle transcripts and context.",
  },
  {
    icon: Sparkles,
    title: "Refine in one pass",
    body: "Answer a few tailored questions so every generation matches your niche and platform goals.",
  },
  {
    icon: Film,
    title: "Ship variations",
    body: "Get multiple short-form outputs you can download, copy, or iterate on with AI feedback.",
  },
];

export function HowItWorks({ className }: { className?: string }) {
  return (
    <section
      id="how-it-works"
      className={cn("scroll-mt-24 border-t border-[#E8E4F8] py-16 dark:border-white/10", className)}
    >
      <div className="mx-auto max-w-6xl px-4">
        <h2 className="text-center text-2xl font-bold tracking-tight text-[#0F0A1E] sm:text-3xl dark:text-white">
          How it works
        </h2>
        <p className="text-muted-foreground mx-auto mt-3 max-w-2xl text-center text-sm sm:text-base">
          Three steps from raw input to clips you can post today.
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="group rounded-2xl border border-[#E8E4F8] bg-white p-6 shadow-sm transition duration-200 hover:scale-[1.02] hover:shadow-md dark:border-white/10 dark:bg-zinc-900"
            >
              <span className="inline-flex size-12 items-center justify-center rounded-xl bg-[#F0EFFE] text-[#6C47FF] dark:bg-violet-950/50 dark:text-violet-300">
                <Icon className="size-6" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-[#0F0A1E] dark:text-white">
                {title}
              </h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
