"use client";

import type { JSX } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { readGuestCreditsRemaining } from "@/lib/guest-credits";
import type { GenerationContextV1 } from "@/lib/generation-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function textFromParts(message: UIMessage) {
  return message.parts
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

export type VideoClipCoachChatProps = {
  /** Present for future gating; chat billing uses session or guest credits. */
  user: { id: string; email: string } | null;
  generationContext: GenerationContextV1 | null;
  /** Shown to the model as workspace context (source + draft prompt), not a transcript. */
  clipBriefPrefix: string;
  onApplyToPrompt: (text: string) => void;
  className?: string;
};

export function VideoClipCoachChat({
  user,
  generationContext,
  clipBriefPrefix,
  onApplyToPrompt,
  className,
}: VideoClipCoachChatProps): JSX.Element {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        credentials: "same-origin",
        body: () => ({
          inputMode: "clip_first" as const,
          generationContext,
          guestCreditsRemaining: readGuestCreditsRemaining(),
        }),
      }),
    [generationContext],
  );

  const { messages, sendMessage, status, stop } = useChat({ transport });
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";

  const wrapUserText = (raw: string) => {
    const b = clipBriefPrefix.trim();
    if (!b) return raw;
    return `[Clip workspace — not a transcript]\n${b}\n\n---\n\n${raw}`;
  };

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col bg-[#0f0816]/95 text-white",
        className,
      )}
    >
      <div className="shrink-0 border-b border-white/10 px-3 py-2.5">
        <p className="text-xs font-medium tracking-wide text-white/85">
          Ada clip coach
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-white/50">
          Hooks, timestamps, and scripts for short-form. Each reply uses one chat
          credit; paste a transcript when you have one for stronger ideas.
        </p>
        {!user ? (
          <p className="mt-1 text-[10px] text-amber-200/85">
            Signed out: replies use guest trial credits in this browser.
          </p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2 text-sm">
        {messages.length === 0 ? (
          <p className="text-white/45">
            Ask for clip angles, hook rewrites, or pacing — same thread as your
            clip run below. While the quick questions are open, the coach sees
            your answers as you go; after you start a job, it uses those
            confirmed settings.
          </p>
        ) : (
          messages.map((m) => {
            const body = textFromParts(m);
            return (
              <div
                key={m.id}
                className={cn(
                  "rounded-lg px-2.5 py-2",
                  m.role === "user"
                    ? "ml-3 border border-white/12 bg-white/5 text-white/90"
                    : "mr-1 border border-[#8800DC]/25 bg-black/35 text-white/90",
                )}
              >
                <p className="wrap-break-word whitespace-pre-wrap text-[13px] leading-snug">
                  {body}
                </p>
                {m.role === "assistant" && body.trim() ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-7 px-2 text-[11px] text-[#e8b4ff] hover:bg-white/10 hover:text-white"
                    onClick={() => onApplyToPrompt(body)}
                  >
                    Add to clip prompt
                  </Button>
                ) : null}
              </div>
            );
          })
        )}
        {busy ? (
          <div className="flex items-center gap-2 text-xs text-white/50">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Thinking…
          </div>
        ) : null}
      </div>
      <form
        className="shrink-0 border-t border-white/10 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = input.trim();
          if (!text || busy) return;
          void sendMessage({ text: wrapUserText(text) });
          setInput("");
        }}
      >
        <div className="flex gap-2">
          <textarea
            rows={2}
            className="min-h-[44px] flex-1 resize-none rounded-lg border border-white/15 bg-white/5 px-2.5 py-2 text-[13px] text-white outline-none placeholder:text-white/35 focus-visible:ring-2 focus-visible:ring-[#8800DC]/40"
            value={input}
            placeholder="Ask the coach…"
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
          />
          {busy ? (
            <Button
              type="button"
              variant="secondary"
              className="shrink-0 self-end border-white/20 bg-white/10 text-white hover:bg-white/15"
              onClick={() => void stop()}
            >
              Stop
            </Button>
          ) : (
            <Button
              type="submit"
              className="shrink-0 self-end rounded-lg border-0 bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] text-white hover:opacity-95"
              disabled={!input.trim()}
            >
              Send
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
