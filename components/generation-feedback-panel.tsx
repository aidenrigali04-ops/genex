"use client";

import { useCallback, useRef, useState } from "react";
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

export function GenerationFeedbackPanel({
  mode,
  videoJobId,
  originalPrompt,
  generationContext,
  variationsOutput,
  onCreditsUpdated,
  onVideoForked,
}: Props) {
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
    <section className="mt-6 space-y-4 rounded-ada-card border border-ada-border bg-ada-card p-5">
      <div>
        <h3 className="text-lg font-semibold text-ada-primary">AI Feedback</h3>
        <p className="text-muted-foreground text-sm">
          Ask the strategist about these results. Each message uses{" "}
          <strong>1 credit</strong> (signed-in users).
        </p>
        {ctxSummary ? (
          <p className="text-muted-foreground mt-2 rounded-lg border border-[#E8E4F8] bg-[#F0EFFE]/60 px-3 py-2 text-xs dark:border-white/10 dark:bg-zinc-900/40">
            <span className="font-medium text-[#0F0A1E] dark:text-zinc-100">Refinement used: </span>
            {ctxSummary}
          </p>
        ) : null}
      </div>

      <div className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-ada-input bg-ada-app p-3">
        {messages.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Ask anything about pacing, hooks, platform fit, or rewrites.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              className={cn(
                "max-w-[95%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                m.role === "user"
                  ? "ml-auto rounded-br-md bg-ada-accent text-white"
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

      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <Button
            key={c}
            type="button"
            size="sm"
            variant="outline"
            className="rounded-ada-pill border border-ada-border bg-transparent text-xs text-ada-secondary hover:border-ada-border-active hover:text-ada-primary"
            disabled={streaming}
            onClick={() => void sendFeedback(c)}
          >
            {c}
          </Button>
        ))}
      </div>

      {mode === "video" && videoJobId && messages.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <span className="text-muted-foreground w-full text-xs font-medium">
            Re-run with the last AI note (full new 5-variation job):
          </span>
          {[1, 2, 3, 4, 5].map((n) => (
            <Button
              key={n}
              type="button"
              size="sm"
              variant="secondary"
              disabled={forking != null || streaming}
              onClick={() => void forkVariation(n)}
            >
              {forking === n ? "Starting…" : `Regenerate variation ${n}`}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="feedback-input">Ask AI about these results…</Label>
        <textarea
          id="feedback-input"
          className="min-h-[80px] w-full resize-none rounded-ada-input border border-ada-border bg-ada-input px-3 py-2 text-sm text-ada-primary outline-none transition-colors placeholder:text-ada-disabled focus:border-ada-focus"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={streaming}
          placeholder="e.g. Which cut should I post first?"
        />
        <Button
          type="button"
          className="rounded-ada-input bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF] px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          disabled={streaming || !input.trim()}
          onClick={() => void sendFeedback(input)}
        >
          {streaming ? "Thinking…" : "Send"}
        </Button>
      </div>
    </section>
  );
}
