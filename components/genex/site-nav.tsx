"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type SiteNavProps = {
  className?: string;
  creditsPill: ReactNode;
  accountSection: ReactNode;
  onGetStarted: () => void;
};

export function SiteNav({
  className,
  creditsPill,
  accountSection,
  onGetStarted,
}: SiteNavProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b border-[#E8E4F8] bg-[#F0EFFE]/90 backdrop-blur-md dark:border-white/10 dark:bg-zinc-950/90",
        className,
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight text-[#0F0A1E] dark:text-white"
        >
          <span
            className="size-2.5 rounded-full bg-[#6C47FF] shadow-[0_0_12px_rgba(108,71,255,0.55)]"
            aria-hidden
          />
          <span className="text-lg">Genex</span>
        </Link>

        <nav className="text-muted-foreground hidden items-center gap-6 text-sm font-medium md:flex">
          <a
            href="#features"
            className="hover:text-[#6C47FF] transition-colors dark:hover:text-violet-300"
          >
            Features
          </a>
          <a
            href="#how-it-works"
            className="hover:text-[#6C47FF] transition-colors dark:hover:text-violet-300"
          >
            How it works
          </a>
          <a
            href="#pricing"
            className="hover:text-[#6C47FF] transition-colors dark:hover:text-violet-300"
          >
            Pricing
          </a>
        </nav>

        <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3">
          {creditsPill}
          <button
            type="button"
            onClick={onGetStarted}
            className="rounded-full bg-[#6C47FF] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#5835E8] genex-cta-glow sm:hidden"
          >
            Start
          </button>
          <button
            type="button"
            onClick={onGetStarted}
            className="hidden rounded-full bg-[#6C47FF] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#5835E8] genex-cta-glow sm:inline-flex"
          >
            Get started
          </button>
          {accountSection}
        </div>
      </div>
    </header>
  );
}
