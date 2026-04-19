"use client";

import type { JSX } from "react";
import { useCallback, useEffect, useRef } from "react";
import { Zap } from "lucide-react";

import { trackAha } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type FirstGenCelebrationProps = {
  onDismiss: () => void;
  variant?: "default" | "adaKit";
  /** When set, fires `first_gen_celebration` aha on mount. */
  userId?: string | null;
};

const PARTICLE_TOKENS = [
  "var(--ada-accent)",
  "var(--ada-accent-hover)",
  "var(--ada-warning)",
  "var(--ada-success)",
] as const;

const PARTICLES: {
  top: string;
  left: string;
  delay: string;
  colorIndex: number;
  size: number;
}[] = [
  { top: "20%", left: "15%", delay: "0ms", colorIndex: 0, size: 8 },
  { top: "15%", left: "50%", delay: "100ms", colorIndex: 1, size: 6 },
  { top: "25%", left: "82%", delay: "60ms", colorIndex: 2, size: 10 },
  { top: "60%", left: "8%", delay: "180ms", colorIndex: 3, size: 7 },
  { top: "70%", left: "90%", delay: "80ms", colorIndex: 0, size: 9 },
  { top: "80%", left: "40%", delay: "140ms", colorIndex: 1, size: 6 },
  { top: "10%", left: "70%", delay: "200ms", colorIndex: 2, size: 8 },
  { top: "50%", left: "95%", delay: "40ms", colorIndex: 3, size: 5 },
  { top: "85%", left: "20%", delay: "160ms", colorIndex: 0, size: 7 },
  { top: "35%", left: "5%", delay: "120ms", colorIndex: 1, size: 6 },
  { top: "90%", left: "65%", delay: "220ms", colorIndex: 2, size: 9 },
  { top: "45%", left: "55%", delay: "20ms", colorIndex: 3, size: 5 },
];

export function FirstGenCelebration({
  onDismiss,
  variant = "default",
  userId,
}: FirstGenCelebrationProps): JSX.Element {
  const kit = variant === "adaKit";
  const dialogRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    void trackAha(supabase, userId, "first_gen_celebration");
  }, [userId]);

  useEffect(() => {
    const t = window.setTimeout(dismiss, 4000);
    return () => window.clearTimeout(t);
  }, [dismiss]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [dismiss]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    el.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = [
        ...el.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((node) => node.offsetParent !== null || node === el);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <style>{`
        @keyframes genex-particle-burst {
          0%   { transform: scale(0) translateY(0);   opacity: 1; }
          60%  { opacity: 1; }
          100% { transform: scale(1) translateY(-60px); opacity: 0; }
        }
        @keyframes genex-celebrate-in {
          0%   { opacity: 0; transform: scale(0.88) translateY(12px); }
          100% { opacity: 1; transform: scale(1)    translateY(0); }
        }
        @keyframes genex-celebrate-pulse {
          0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ada-accent) 0%, transparent); }
          50%       { box-shadow: 0 0 0 16px color-mix(in srgb, var(--ada-accent) 18%, transparent); }
        }
        .genex-celebrate-in {
          animation: genex-celebrate-in 420ms cubic-bezier(0.16,1,0.3,1) forwards;
        }
        .genex-celebrate-pulse {
          animation: genex-celebrate-pulse 1.8s ease-in-out infinite;
        }
        .genex-particle {
          animation: genex-particle-burst 900ms ease-out forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .genex-celebrate-in, .genex-celebrate-pulse, .genex-particle {
            animation: none !important;
          }
        }
      `}</style>

      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        onClick={dismiss}
        aria-hidden
      >
        <div
          className={cn(
            "absolute inset-0 transition-opacity",
            kit
              ? "bg-black/60 backdrop-blur-sm"
              : "bg-black/40 backdrop-blur-sm",
          )}
        />
      </div>

      <div
        className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
        aria-hidden
      >
        {PARTICLES.map((p, i) => (
          <div
            key={i}
            className="genex-particle absolute rounded-full"
            style={{
              top: p.top,
              left: p.left,
              width: p.size,
              height: p.size,
              background: PARTICLE_TOKENS[p.colorIndex % PARTICLE_TOKENS.length],
              animationDelay: p.delay,
            }}
          />
        ))}
      </div>

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Your first clip package is ready"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "genex-celebrate-in genex-celebrate-pulse",
          "fixed left-1/2 top-1/2 z-50 w-[min(360px,90vw)] -translate-x-1/2 -translate-y-1/2",
          "rounded-2xl border p-6 text-center shadow-2xl outline-none",
          kit
            ? "border-white/15 bg-[#0A050F] text-white"
            : "border-ada-border bg-ada-card text-ada-primary",
        )}
      >
        <div
          className={cn(
            "mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full",
            kit
              ? "bg-[linear-gradient(135deg,#D31CD7_0%,#8800DC_100%)] shadow-[0_0_32px_rgba(203,45,206,0.4)]"
              : "bg-(--ada-accent-gradient) shadow-[0_0_24px_color-mix(in_srgb,var(--ada-accent)_35%,transparent)]",
          )}
        >
          <Zap className="h-7 w-7 text-white" aria-hidden />
        </div>

        <h2
          className={cn(
            "mb-1.5 text-lg font-semibold tracking-tight",
            kit ? "text-white" : "text-ada-primary",
          )}
        >
          Your first clip is ready 🎉
        </h2>

        <p
          className={cn(
            "mb-5 text-sm leading-relaxed",
            kit ? "text-white/60" : "text-ada-secondary",
          )}
        >
          Copy a hook and post it today. The best creators ship before they&apos;re
          ready.
        </p>

        <button
          type="button"
          onClick={dismiss}
          className={cn(
            "w-full rounded-full py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 active:scale-[0.98]",
            kit
              ? "bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] text-white"
              : "bg-(--ada-accent-gradient) text-(--ada-text-inverse)",
          )}
        >
          Let&apos;s go
        </button>

        <p
          className={cn(
            "mt-3 text-[11px]",
            kit ? "text-white/30" : "text-ada-disabled",
          )}
        >
          Dismisses automatically
        </p>
      </div>
    </>
  );
}
