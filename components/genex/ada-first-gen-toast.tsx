"use client";

import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Zap } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { trackAha } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const SESSION_KEY = "genex_first_gen_shown";

/** Survives React Strict Mode remount so we do not dismiss while the same toast is logically open. */
let genexFirstGenToastInstanceOpen = false;

let firstGenerationCompleteAhaLogged = false;

const PARTICLE_LEFT = ["15%", "28%", "42%", "58%", "72%", "85%"] as const;
const PARTICLE_X_END = [-28, 12, -8, 28, -18, 6] as const;
const PARTICLE_COLORS = [
  "var(--ada-accent)",
  "#22C55E",
  "#F59E0B",
  "var(--ada-accent)",
  "#22C55E",
  "#F59E0B",
] as const;

export type AdaFirstGenToastProps = {
  onDismiss: () => void;
  variant?: "default" | "adaKit";
  userId?: string;
  supabase?: SupabaseClient;
};

export function AdaFirstGenToast({
  onDismiss,
  variant = "default",
  userId,
  supabase: supabaseProp,
}: AdaFirstGenToastProps): JSX.Element | null {
  const kit = variant === "adaKit";
  const [mounted, setMounted] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(true);
  const defaultSupabase = useMemo(() => createClient(), []);
  const supabase = supabaseProp ?? defaultSupabase;

  const handleDismiss = useCallback(() => {
    genexFirstGenToastInstanceOpen = false;
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    let proceed = false;
    try {
      const w = typeof window !== "undefined";
      const existing = w ? sessionStorage.getItem(SESSION_KEY) : null;
      if (existing) {
        if (genexFirstGenToastInstanceOpen) {
          proceed = true;
        } else {
          handleDismiss();
          return;
        }
      } else {
        if (w) {
          sessionStorage.setItem(SESSION_KEY, "1");
        }
        genexFirstGenToastInstanceOpen = true;
        proceed = true;
      }
    } catch {
      handleDismiss();
      return;
    }

    if (!proceed) return;

    let mqCleanup: (() => void) | undefined;
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      queueMicrotask(() => {
        setMounted(true);
        setReduceMotion(mq.matches);
      });
      const listener = () => setReduceMotion(mq.matches);
      mq.addEventListener("change", listener);
      mqCleanup = () => mq.removeEventListener("change", listener);
    } catch {
      queueMicrotask(() => {
        setMounted(true);
        setReduceMotion(false);
      });
    }

    const t = window.setTimeout(handleDismiss, 4000);
    return () => {
      mqCleanup?.();
      window.clearTimeout(t);
    };
  }, [handleDismiss]);

  useEffect(() => {
    if (!mounted) return;
    const uid = userId?.trim();
    if (!uid) return;
    if (firstGenerationCompleteAhaLogged) return;
    firstGenerationCompleteAhaLogged = true;
    try {
      void trackAha(supabase, uid, "first_generation_complete");
    } catch {
      /* silent */
    }
  }, [mounted, userId, supabase]);

  if (!mounted) {
    return null;
  }

  const keyframesCss = PARTICLE_X_END.map(
    (x, i) => `
    @keyframes confetti-${i} {
      0% { transform: translateY(0) translateX(0) rotate(0deg); opacity: 1; }
      100% { transform: translateY(-60px) translateX(${x}px) rotate(180deg); opacity: 0; }
    }
  `,
  ).join("");

  return (
    <>
      <style>{keyframesCss}</style>
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-3">
        <div className="pointer-events-auto relative w-[min(92vw,420px)] overflow-visible">
          {!reduceMotion ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-full flex justify-center overflow-visible">
              {PARTICLE_LEFT.map((left, i) => (
                <div
                  key={i}
                  className="absolute top-0 rounded-[2px]"
                  style={{
                    left,
                    top: 0,
                    width: 6,
                    height: 6,
                    backgroundColor: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
                    animation: `confetti-${i} 0.9s ease-out forwards`,
                    animationDelay: `${i * 80}ms`,
                  }}
                />
              ))}
            </div>
          ) : null}

          <div
            role="status"
            aria-live="polite"
            className={cn(
              "animate-in slide-in-from-bottom-4 fade-in duration-300 flex items-center gap-3 rounded-2xl border border-ada-border px-4 py-3 shadow-lg",
              kit
                ? "border-white/20 bg-[#1a0a2e] shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
                : "bg-ada-card",
            )}
          >
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                kit
                  ? "bg-[linear-gradient(135deg,#D31CD7_0%,#8800DC_100%)]"
                  : "bg-[var(--ada-accent)]",
              )}
            >
              <Zap className="h-5 w-5 text-white" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm font-semibold",
                  kit ? "text-white" : "text-ada-primary",
                )}
              >
                ⚡ First clip package ready
              </p>
              <p
                className={cn(
                  "mt-0.5 text-xs",
                  kit ? "text-white/60" : "text-ada-secondary",
                )}
              >
                Copy a hook to keep it.
              </p>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={handleDismiss}
              className={cn(
                "shrink-0 rounded-full p-1.5 transition-colors",
                kit
                  ? "text-white/40 hover:text-white/80"
                  : "text-ada-disabled hover:text-ada-primary",
              )}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
