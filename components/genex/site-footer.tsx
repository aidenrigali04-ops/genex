"use client";

import { cn } from "@/lib/utils";

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "border-t border-[#E8E4F8] bg-white/60 py-12 dark:border-white/10 dark:bg-zinc-950/60",
        className,
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 font-semibold text-[#0F0A1E] dark:text-white">
            <span
              className="size-2.5 rounded-full bg-[#6C47FF]"
              aria-hidden
            />
            Genex
          </div>
          <p className="text-muted-foreground mt-2 max-w-xs text-sm">
            Viral short-form clips from one workspace.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
          <div>
            <p className="font-semibold text-[#0F0A1E] dark:text-white">Product</p>
            <ul className="text-muted-foreground mt-2 space-y-1.5">
              <li>
                <a href="#workspace" className="hover:text-[#6C47FF]">
                  Workspace
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-[#6C47FF]">
                  Features
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-[#0F0A1E] dark:text-white">Company</p>
            <ul className="text-muted-foreground mt-2 space-y-1.5">
              <li>
                <a href="#how-it-works" className="hover:text-[#6C47FF]">
                  How it works
                </a>
              </li>
              <li>
                <a href="#pricing" className="hover:text-[#6C47FF]">
                  Pricing
                </a>
              </li>
            </ul>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <p className="font-semibold text-[#0F0A1E] dark:text-white">Legal</p>
            <p className="text-muted-foreground mt-2 text-xs">
              © {new Date().getFullYear()} Genex. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
