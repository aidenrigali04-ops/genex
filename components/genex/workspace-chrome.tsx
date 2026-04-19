"use client";

import type { JSX, ReactNode } from "react";
import { Bell, Play, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ThemeToggle } from "./theme-toggle";

export type WorkspaceChromeProps = {
  className?: string;
  workspaceTab: "video" | "clip";
  onWorkspaceTab: (tab: "video" | "clip") => void;
  onUpgrade: () => void;
  /** Opens settings sheet on small screens, or scrolls to the settings rail on large screens. */
  onOpenSettings?: () => void;
  onPlayPreview?: () => void;
  accountSection?: ReactNode;
  /** Main workspace below the chrome bar (video tab). */
  videoWorkspace?: ReactNode;
  /** Main workspace below the chrome bar (clip tab). */
  clipWorkspace?: ReactNode;
};

const TAB_LABEL: Record<"video" | "clip", string> = {
  video: "Video",
  clip: "Clip",
};

const TABS = ["video", "clip"] as const;

export function WorkspaceChrome({
  className,
  workspaceTab,
  onWorkspaceTab,
  onUpgrade,
  onOpenSettings,
  onPlayPreview,
  accountSection,
  videoWorkspace,
  clipWorkspace,
}: WorkspaceChromeProps): JSX.Element {
  const hasMain = videoWorkspace != null || clipWorkspace != null;

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        hasMain && "overflow-hidden",
        className,
      )}
    >
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-[#E8E4F8] bg-[#FAFAFC]/80 px-4 py-3 backdrop-blur-md dark:border-white/10 dark:bg-zinc-900/40",
      )}
    >
      <div
        className="flex items-center gap-1 rounded-full border border-white/40 bg-white/30 p-0.5 backdrop-blur-sm dark:border-white/10 dark:bg-white/5"
        role="tablist"
        aria-label="Workspace mode"
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={workspaceTab === tab}
            onClick={() => onWorkspaceTab(tab)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              workspaceTab === tab
                ? "border border-white/60 bg-white/70 text-[#6C47FF] shadow-sm backdrop-blur-sm dark:border-white/20 dark:bg-white/15 dark:text-violet-200"
                : "border border-transparent text-[#9B8EC4] hover:bg-white/30 hover:text-[#1a1030] dark:hover:bg-white/10 dark:hover:text-zinc-100",
            )}
          >
            {TAB_LABEL[tab]}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        {onOpenSettings ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-[#6B6B8A] dark:text-zinc-400"
            aria-label="Settings"
            onClick={() => onOpenSettings()}
          >
            <Settings className="size-5" aria-hidden />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-[#6B6B8A] dark:text-zinc-400"
          aria-label="Notifications"
        >
          <Bell className="size-5" />
        </Button>
        <ThemeToggle />
        {accountSection ? (
          <span className="flex items-center">{accountSection}</span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-[#6B6B8A] dark:text-zinc-400"
          aria-label="Scroll to preview"
          disabled={!onPlayPreview}
          onClick={() => onPlayPreview?.()}
        >
          <Play className="size-5" />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="rounded-full border border-[#E8E4F8] bg-white font-semibold text-[#6C47FF] shadow-sm hover:bg-[#F0EFFE] dark:border-white/10 dark:bg-zinc-800 dark:text-violet-300 dark:hover:bg-zinc-700"
          onClick={onUpgrade}
        >
          Upgrade
        </Button>
      </div>
    </div>
    {hasMain ? (
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {workspaceTab === "video" ? videoWorkspace : clipWorkspace}
      </div>
    ) : null}
    </div>
  );
}
