"use client";

import {
  ChevronRight,
  CreditCard,
  LayoutGrid,
  Music,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type SettingsRailProps = {
  className?: string;
  mode: "clip" | "video";
  platformLabel: string;
  presetLabel?: string | null;
  creditsLine: string;
};

export function SettingsRail({
  className,
  mode,
  platformLabel,
  presetLabel,
  creditsLine,
}: SettingsRailProps) {
  const styleValue =
    mode === "clip"
      ? presetLabel && presetLabel.trim()
        ? presetLabel
        : "None"
      : "5 variations";

  const rows = [
    {
      icon: LayoutGrid,
      label: "Platform",
      value: platformLabel,
    },
    {
      icon: Sparkles,
      label: mode === "clip" ? "Preset" : "Output",
      value: styleValue,
    },
    {
      icon: Music,
      label: "Music",
      value: "Off",
    },
    {
      icon: CreditCard,
      label: "Credits",
      value: creditsLine,
    },
  ];

  return (
    <aside
      aria-label="Workspace settings summary"
      className={cn(
        "rounded-2xl border border-[#E8E4F8] bg-[#FAFAFC] p-3 dark:border-white/10 dark:bg-zinc-900/40",
        className,
      )}
    >
      <p className="text-muted-foreground mb-2 px-1 text-xs font-semibold uppercase tracking-wide">
        Settings
      </p>
      <p className="sr-only">
        Read-only summary of platform, style, music, and credits for this workspace.
      </p>
      <ul className="divide-y divide-[#E8E4F8] dark:divide-white/10" role="list">
        {rows.map(({ icon: Icon, label, value }) => (
          <li key={label}>
            <div className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#6C47FF] shadow-sm dark:bg-zinc-800 dark:text-violet-300"
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-[#6B6B8A] dark:text-zinc-400">
                  {label}
                </span>
                <span className="block truncate text-sm font-semibold text-[#0F0A1E] dark:text-zinc-100">
                  {value}
                </span>
              </span>
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-[#C4BAF0] dark:text-zinc-600"
              />
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
