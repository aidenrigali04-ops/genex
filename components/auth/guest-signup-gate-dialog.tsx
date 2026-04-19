"use client";

import Link from "next/link";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const MAGENTA_GRAD =
  "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] shadow-[0_0_20px_rgba(203,45,206,0.24)]";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Post-auth return path (e.g. `/`). */
  nextPath?: string;
  onOpenWaitlist?: () => void;
};

export function GuestSignupGateDialog({
  open,
  onOpenChange,
  nextPath = "/",
  onOpenWaitlist,
}: Props) {
  const next = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  const signUpHref = `/auth/sign-up?next=${encodeURIComponent(next)}`;
  const loginHref = `/auth/login?next=${encodeURIComponent(next)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="max-w-[min(calc(100vw-24px),400px)] border border-white/15 bg-[#12081c] p-6 text-white shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
      >
        <DialogHeader className="space-y-2 text-left">
          <DialogTitle className="font-[family-name:var(--font-instrument-serif)] text-2xl font-normal tracking-wide text-white">
            You&apos;re out of free generations
          </DialogTitle>
          <DialogDescription className="font-[family-name:var(--font-instrument-sans)] text-sm leading-5 text-white/64">
            Create a free account to save your work and unlock more credits, or
            join the waitlist for paid plans.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-3">
          <Link
            href={signUpHref}
            className={cn(
              "inline-flex h-auto w-full items-center justify-center rounded-[32px] border-0 py-2.5 text-center font-[family-name:var(--font-instrument-sans)] text-sm font-medium text-white no-underline outline-none transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-[#8800DC]/50",
              MAGENTA_GRAD,
            )}
            onClick={() => onOpenChange(false)}
          >
            Create free account
          </Link>
          <Link
            href={loginHref}
            className="inline-flex h-auto w-full items-center justify-center rounded-[32px] border border-white/30 bg-transparent py-2.5 text-center font-[family-name:var(--font-instrument-sans)] text-sm text-white no-underline outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/30"
            onClick={() => onOpenChange(false)}
          >
            I already have an account
          </Link>
          {onOpenWaitlist ? (
            <button
              type="button"
              className="text-center font-[family-name:var(--font-instrument-sans)] text-sm text-white/50 underline-offset-2 hover:text-white/70 hover:underline"
              onClick={() => {
                onOpenWaitlist();
                onOpenChange(false);
              }}
            >
              Join the waitlist
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
