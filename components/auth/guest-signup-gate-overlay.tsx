"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

const MAGENTA_GRAD =
  "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] shadow-[0_0_20px_rgba(203,45,206,0.24)]";

type Props = {
  open: boolean;
  /** Post-auth return path (e.g. `/`). */
  nextPath?: string;
};

/**
 * Full-screen gate when anonymous users exhaust lifetime guest credits.
 */
export function GuestSignupGateOverlay({ open, nextPath = "/" }: Props) {
  const next =
    nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  const signUpHref = `/auth/sign-up?next=${encodeURIComponent(next)}`;
  const loginHref = `/auth/login?next=${encodeURIComponent(next)}`;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 bg-[#0A050F]/95 px-6 py-10 text-center backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-gate-title"
    >
      <h1
        id="guest-gate-title"
        className="max-w-md font-[family-name:var(--font-instrument-serif)] text-3xl font-normal tracking-wide text-white sm:text-4xl"
      >
        Create an account to continue
      </h1>
      <p className="max-w-md font-[family-name:var(--font-instrument-sans)] text-sm leading-relaxed text-white/64">
        You&apos;ve used your five free credits on the dashboard (write + video
        previews). Create an account to pick a plan — every tier has a 3-day
        free trial — then keep creating or buy optional top-ups when you need
        more.
      </p>
      <div className="flex w-full max-w-sm flex-col gap-3">
        <Link
          href={signUpHref}
          className={cn(
            "inline-flex items-center justify-center rounded-[32px] border-0 py-3 text-center font-[family-name:var(--font-instrument-sans)] text-sm font-medium text-white no-underline outline-none transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-[#8800DC]/50",
            MAGENTA_GRAD,
          )}
        >
          Create account
        </Link>
        <Link
          href={loginHref}
          className="inline-flex items-center justify-center rounded-[32px] border border-white/30 bg-transparent py-3 text-center font-[family-name:var(--font-instrument-sans)] text-sm text-white no-underline outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/30"
        >
          I already have an account
        </Link>
      </div>
    </div>
  );
}
