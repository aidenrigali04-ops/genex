"use client";

import { Clock, FileText, LogOut, User, Video, Zap } from "lucide-react";

import {
  FREE_DAILY_CREDITS,
  UNLIMITED_CREDITS_SENTINEL,
} from "@/lib/credits-config";
import { cn } from "@/lib/utils";

export type AdaSidebarRecentItem = {
  id: string;
  label: string;
  onSelect: () => void;
};

export type AdaSidebarProps = {
  user: { id: string; email: string } | null;
  creditsRemaining: number;
  creditsUnlimited: boolean;
  workspaceTab: "video" | "clip";
  onWorkspaceTab: (t: "video" | "clip") => void;
  onUpgrade: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  recentItems?: AdaSidebarRecentItem[];
};

const NAV_ITEMS = [
  {
    id: "video" as const,
    label: "Video Clips",
    icon: Video,
    desc: "Cut real footage into clips",
  },
  {
    id: "clip" as const,
    label: "Clip Package",
    icon: FileText,
    desc: "Turn ideas into copy",
  },
];

export function AdaSidebar({
  user,
  creditsRemaining,
  creditsUnlimited,
  workspaceTab,
  onWorkspaceTab,
  onUpgrade,
  onSignIn,
  onSignOut,
  recentItems = [],
}: AdaSidebarProps) {
  const denom = Math.max(10, FREE_DAILY_CREDITS);
  const creditPercent = creditsUnlimited
    ? 100
    : Math.max(0, Math.min(100, (creditsRemaining / denom) * 100));
  const isUnlimitedVal =
    creditsUnlimited || creditsRemaining === UNLIMITED_CREDITS_SENTINEL;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b border-ada-border px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-linear-to-br from-[#7B5CFA] to-[#9B6FFF]">
          <Zap className="h-4 w-4 text-white" aria-hidden />
        </div>
        <span className="text-base font-semibold tracking-tight text-ada-primary">
          GenEx
        </span>
      </div>

      <div className="p-4">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-ada-input bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 active:scale-[0.98]"
          onClick={() => onWorkspaceTab(workspaceTab)}
        >
          <span aria-hidden>+</span> New Generation
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
        <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-widest text-ada-disabled">
          Workspace
        </p>
        {NAV_ITEMS.map(({ id, label, icon: Icon, desc }) => (
          <button
            key={id}
            type="button"
            onClick={() => onWorkspaceTab(id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-ada-input px-3 py-2.5 text-left transition-colors",
              workspaceTab === id
                ? "bg-ada-accent-subtle text-ada-accent-hover"
                : "text-ada-secondary hover:bg-ada-card hover:text-ada-primary",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{label}</div>
              <div className="truncate text-[10px] text-ada-disabled">{desc}</div>
            </div>
            {workspaceTab === id ? (
              <div
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-ada-accent"
                aria-hidden
              />
            ) : null}
          </button>
        ))}

        <p className="px-2 pb-1 pt-4 text-[10px] font-medium uppercase tracking-widest text-ada-disabled">
          Recent
        </p>
        {recentItems.length === 0 ? (
          <p className="px-3 py-2 text-xs text-ada-disabled">No recent items yet.</p>
        ) : (
          recentItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={item.onSelect}
              className="flex w-full items-center gap-3 rounded-ada-input px-3 py-2 text-left text-sm text-ada-secondary transition-colors hover:bg-ada-card hover:text-ada-primary"
            >
              <Clock className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
              <span className="truncate">{item.label}</span>
            </button>
          ))
        )}
      </nav>

      <div className="space-y-3 border-t border-ada-border p-4">
        <button type="button" onClick={onUpgrade} className="w-full space-y-1.5 text-left">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ada-secondary">Credits</span>
            <span className="font-medium text-ada-accent-hover">
              {isUnlimitedVal ? "∞" : creditsRemaining} left
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ada-border">
            <div
              className="h-full rounded-full bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF] transition-all duration-500"
              style={{ width: `${creditPercent}%` }}
            />
          </div>
          <p className="text-[10px] text-ada-disabled">Upgrade for unlimited generations</p>
        </button>

        <div
          role="button"
          tabIndex={0}
          className="flex cursor-pointer items-center gap-2.5 rounded-ada-input p-2 transition-colors hover:bg-ada-card"
          onClick={() => {
            if (!user) onSignIn();
          }}
          onKeyDown={(e) => {
            if (!user && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              onSignIn();
            }
          }}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-[#7B5CFA] to-[#9B6FFF] text-xs font-bold text-white">
            {user ? (
              user.email.charAt(0).toUpperCase()
            ) : (
              <User className="h-3.5 w-3.5" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ada-primary">
              {user?.email ?? "Guest user"}
            </div>
            <div className="text-[10px] text-ada-disabled">
              {user ? "Signed in" : "Click to sign in"}
            </div>
          </div>
          {user ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void onSignOut();
              }}
              className="text-ada-disabled transition-colors hover:text-ada-error"
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
