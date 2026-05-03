"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  buildSummaryFromContext,
  isGenerationContextV1,
  type GenerationContextV1,
} from "@/lib/generation-context";
import { cn } from "@/lib/utils";

type Props = {
  mode: "video" | "clip";
  /** Dark glass styling when embedded in Ada kit clip shell. */
  variant?: "default" | "adaKit";
  /** Tighter chrome for inline chat action rows (clip turns). */
  compact?: boolean;
  /** For fork actions */
  videoJobId?: string | null;
  originalPrompt: string;
  generationContext: GenerationContextV1 | null;
  variationsOutput: string;
  onCreditsUpdated?: (remaining: number) => void;
  /** After a successful fork, parent can switch to new job polling */
  onVideoForked?: (newJobId: string) => void;
};

const CLIP_CHIPS = [
  "Which hook will perform best on TikTok?",
  "Make the script more aggressive",
  "Rewrite the hook for a fitness audience",
  "What hashtags should I use for this niche?",
];

const VIDEO_CHIPS = [
  "Which variation will perform best on TikTok?",
  "Make variation 3 more aggressive",
  "Rewrite the hook for a fitness audience",
  "What hashtags should I use for this niche?",
];

function promptPreview(prompt: string): string {
  const clean = prompt.trim();
  if (!clean) return "No prompt provided.";
  return clean.length > 180 ? `${clean.slice(0, 180)}…` : clean;
}

export function GenerationFeedbackPanel({
  mode,
  variant = "default",
  compact = false,
  videoJobId,
  originalPrompt,
  generationContext,
  variationsOutput,
  onCreditsUpdated,
  onVideoForked,
}: Props) {
  const kit = variant === "adaKit";
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [forking, setForking] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ctxSummary =
    generationContext && isGenerationContextV1(generationContext)
      ? buildSummaryFromContext(generationContext)
      : "";
  const resultSummary = useMemo(() => {
    if (mode === "video") {
      const variationCount = (variationsOutput.match(/Variation\s+\d+:/g) ?? [])
        .length;
      if (variationCount > 0) {
        return `${variationCount} variation result${variationCount === 1 ? "" : "s"} ready`;
      }
      return "Video result ready";
    }
    const chars = variationsOutput.trim().length;
    if (chars > 0) {
      const words = Math.max(
        1,
        variationsOutput
          .trim()
          .split(/\s+/)
          .filter(Boolean).length,
      );
      return `${words} words generated`;
    }
    return "Clip package ready";
  }, [mode, variationsOutput]);

  const sendFeedback = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setMessages((m) => [...m, { role: "user", text: trimmed }]);
      setInput("");
      setStreaming(true);

      let assistant = "";
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          signal: abortRef.current.signal,
          body: JSON.stringify({
            originalPrompt,
            generationContext,
            variationsOutput,
            userMessage: trimmed,
          }),
        });

        if (res.status === 401) {
          toast.error("Sign in to use AI feedback.");
          setMessages((m) => m.slice(0, -1));
          return;
        }
        if (res.status === 403) {
          const j = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          toast.error(
            j.error === "no_credits"
              ? "Not enough credits for feedback (1 credit per message)."
              : "Could not use credits.",
          );
          setMessages((m) => m.slice(0, -1));
          return;
        }
        if (!res.ok || !res.body) {
          toast.error("Feedback request failed.");
          setMessages((m) => m.slice(0, -1));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        setMessages((m) => [...m, { role: "assistant", text: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            assistant += decoder.decode(value, { stream: true });
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") {
                copy[copy.length - 1] = { role: "assistant", text: assistant };
              }
              return copy;
            });
          }
        }
        assistant += decoder.decode();
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") {
            copy[copy.length - 1] = { role: "assistant", text: assistant };
          }
          return copy;
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        toast.error(e instanceof Error ? e.message : "Feedback failed.");
        setMessages((m) => {
          const copy = [...m];
          if (copy.at(-1)?.role === "assistant" && !copy.at(-1)?.text) {
            copy.pop();
          }
          if (copy.at(-1)?.role === "user" && copy.at(-1)?.text === trimmed) {
            copy.pop();
          }
          return copy;
        });
      } finally {
        setStreaming(false);
      }
    },
    [generationContext, originalPrompt, streaming, variationsOutput],
  );

  const forkVariation = async (n: number) => {
    if (!videoJobId || mode !== "video") {
      toast.message("Fork is only available for completed video jobs.");
      return;
    }
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const base = lastAssistant?.text?.trim() || input.trim();
    const instructions =
      base.length > 0
        ? `Apply this strategist feedback when re-cutting:\n${base.slice(0, 8000)}`
        : `Re-cut with a fresh take on variation ${n}, keeping the same source video.`;

    setForking(n);
    try {
      const res = await fetch(`/api/video-jobs/${videoJobId}/fork`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instructions: `${instructions}\n(Emphasis: variation ${n} from the previous batch.)`,
          focusVariation: n,
        }),
      });
      const data = (await res.json()) as {
        id?: string;
        error?: string;
        message?: string;
        remainingCredits?: number;
      };
      if (!res.ok || !data.id) {
        toast.error(String(data.message || data.error || "Fork failed."));
        return;
      }
      if (typeof data.remainingCredits === "number" && onCreditsUpdated) {
        onCreditsUpdated(data.remainingCredits);
      }
      toast.success(`New job started (${data.id.slice(0, 8)}…).`);
      onVideoForked?.(data.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fork failed.");
    } finally {
      setForking(null);
    }
  };

  const chips = mode === "video" ? VIDEO_CHIPS : CLIP_CHIPS;

  return (
    <section
      className={cn(
        "rounded-2xl border",
        compact ? "mt-0 space-y-2 p-3" : "mt-6 space-y-4 p-5",
        kit
          ? "border-white/14 bg-white/[0.06] font-[family-name:var(--font-instrument-sans)] text-white backdrop-blur-sm outline outline-1 -outline-offset-1 outline-white/10"
          : "rounded-ada-card border-ada-border bg-ada-card",
      )}
    >
      <div className={cn(compact ? "space-y-1.5" : "space-y-2")}>
        {compact ? (
          <p
            className={cn(
              "text-xs font-semibold tracking-wide",
              kit ? "text-white/80" : "text-ada-primary",
            )}
          >
            AI feedback · 1 credit / message (signed-in)
          </p>
        ) : (
          <h3
            className={cn(
              "text-lg font-semibold",
              kit
                ? "font-[family-name:var(--font-instrument-serif)] text-xl font-normal tracking-[0.36px] text-white"
                : "text-ada-primary",
            )}
          >
            AI Feedback
          </h3>
        )}
        {!compact ? (
          <p className={cn("text-sm", kit ? "text-white/55" : "text-muted-foreground")}>
            Ask the strategist about these results. Each message uses{" "}
            <strong className={kit ? "text-white/90" : undefined}>1 credit</strong> (signed-in
            users).
          </p>
        ) : null}
        <div
          className={cn(
            "rounded-xl border px-3 py-2 text-xs",
            kit
              ? "border-white/12 bg-black/25 text-white/75"
              : "border-[#E8E4F8] bg-[#F7F6FF]/70 text-muted-foreground dark:border-white/10 dark:bg-zinc-900/40",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cn("font-medium", kit ? "text-white/90" : "text-[#0F0A1E] dark:text-zinc-100")}>
              Goal + result
            </span>
            <span className={cn("text-[11px]", kit ? "text-white/55" : "text-muted-foreground")}>
              {resultSummary}
            </span>
          </div>
          <p className={cn("mt-1 line-clamp-2", kit ? "text-white/70" : "text-muted-foreground")}>
            {promptPreview(originalPrompt)}
          </p>
        </div>
        {ctxSummary ? (
          <details
            className={cn(
              "rounded-xl border text-xs",
              compact ? "mt-1.5" : "mt-2",
              kit
                ? "border-white/12 bg-black/20 text-white/75"
                : "text-muted-foreground border-[#E8E4F8] bg-[#F0EFFE]/50 dark:border-white/10 dark:bg-zinc-900/30",
            )}
          >
            <summary
              className={cn(
                "cursor-pointer px-3 py-2 font-medium",
                kit ? "text-white/80" : "text-[#0F0A1E] dark:text-zinc-100",
              )}
            >
              Refinement context
            </summary>
            <p className="border-t border-current/10 px-3 py-2 text-[11px] leading-relaxed">
              {ctxSummary}
            </p>
          </details>
        ) : null}
      </div>

      <div
        className={cn(
          "flex flex-col gap-3 overflow-y-auto rounded-xl p-3",
          compact ? "max-h-48" : "max-h-72",
          kit ? "border border-white/10 bg-black/25" : "rounded-ada-input bg-ada-app",
        )}
      >
        {messages.length === 0 ? (
          <p
            className={cn(
              compact ? "text-xs" : "text-sm",
              kit ? "text-white/50" : "text-muted-foreground",
            )}
          >
            Ask anything about pacing, hooks, platform fit, or rewrites.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              className={cn(
                "max-w-[95%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                m.role === "user"
                  ? kit
                    ? "ml-auto rounded-br-md bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white"
                    : "ml-auto rounded-br-md bg-ada-accent text-white"
                  : kit
                    ? "mr-auto rounded-bl-md border border-white/16 bg-white/10 text-white/95"
                    : "mr-auto rounded-bl-md border border-ada-border bg-ada-elevated text-ada-primary",
              )}
            >
              <pre className="font-sans whitespace-pre-wrap wrap-break-word">
                {m.text || (streaming && i === messages.length - 1 ? "…" : "")}
              </pre>
            </div>
          ))
        )}
      </div>

      <div className={cn("flex gap-2", compact ? "max-w-full flex-nowrap overflow-x-auto pb-1" : "flex-wrap")}>
        {chips.map((c) => (
          <Button
            key={c}
            type="button"
            size="sm"
            variant="outline"
            className={cn(
              "shrink-0 rounded-full text-xs",
              kit
                ? "border-white/32 bg-transparent text-white/85 hover:border-white/50 hover:bg-white/10 hover:text-white"
                : "rounded-ada-pill border-ada-border text-ada-secondary hover:border-ada-border-active hover:text-ada-primary",
            )}
            disabled={streaming}
            onClick={() => void sendFeedback(c)}
          >
            {c}
          </Button>
        ))}
      </div>

      {mode === "video" && videoJobId && messages.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <span
            className={cn(
              "w-full text-xs font-medium",
              kit ? "text-white/50" : "text-muted-foreground",
            )}
          >
            Re-run with the last AI note (full new 5-variation job):
          </span>
          {[1, 2, 3, 4, 5].map((n) => (
            <Button
              key={n}
              type="button"
              size="sm"
              variant="secondary"
              className={cn(
                kit
                  ? "border-white/16 bg-white/10 text-white hover:bg-white/15"
                  : undefined,
              )}
              disabled={forking != null || streaming}
              onClick={() => void forkVariation(n)}
            >
              {forking === n ? "Starting…" : `Regenerate variation ${n}`}
            </Button>
          ))}
        </div>
      ) : null}

      <div className={cn(compact ? "space-y-1.5" : "space-y-2")}>
        <Label
          htmlFor="feedback-input"
          className={cn(kit ? "text-white/65" : undefined, compact && "text-xs")}
        >
          Ask AI about this result…
        </Label>
        <textarea
          id="feedback-input"
          className={cn(
            "w-full resize-none rounded-xl border px-3 py-2 text-sm outline-none transition-colors",
            compact ? "min-h-[56px]" : "min-h-[80px]",
            kit
              ? "border-white/20 bg-black/30 text-white placeholder:text-white/45 focus:border-white/40"
              : "rounded-ada-input border-ada-border bg-ada-input text-ada-primary placeholder:text-ada-disabled focus:border-ada-focus",
          )}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={streaming}
          placeholder="e.g. Which cut should I post first?"
        />
        <Button
          type="button"
          className={cn(
            "rounded-full px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40",
            kit
              ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] shadow-[0_0_20px_rgba(203,45,206,0.2)]"
              : "rounded-ada-input bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF]",
          )}
          disabled={streaming || !input.trim()}
          onClick={() => void sendFeedback(input)}
        >
          {streaming ? "Thinking…" : "Send"}
        </Button>
      </div>
    </section>
  );
}
