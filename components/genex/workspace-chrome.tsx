"use client";

import type { ReactNode } from "react";
import { Bell, ChevronDown, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { ThemeToggle } from "./theme-toggle";

export type WorkspaceChromeProps = {
  className?: string;
  workspaceTab: "video" | "clip";
  onWorkspaceTab: (tab: "video" | "clip") => void;
  onUpgrade: () => void;
  onPlayPreview?: () => void;
  accountSection?: ReactNode;
};

const TAB_LABEL: Record<"video" | "clip", string> = {
  video: "Video",
  clip: "Clip",
};

export function WorkspaceChrome({
  className,
  workspaceTab,
  onWorkspaceTab,
  onUpgrade,
  onPlayPreview,
  accountSection,
}: WorkspaceChromeProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-[#E8E4F8] bg-[#FAFAFC] px-4 py-3 dark:border-white/10 dark:bg-zinc-900/50",
        className,
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-full border-[#E8E4F8] bg-white font-medium dark:border-white/15 dark:bg-zinc-900"
          >
            {TAB_LABEL[workspaceTab]}
            <ChevronDown className="size-4 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          <DropdownMenuItem onClick={() => onWorkspaceTab("video")}>
            Video
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onWorkspaceTab("clip")}>
            Clip
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex items-center gap-1 sm:gap-2">
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
          onClick={onPlayPreview}
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
  );
}
