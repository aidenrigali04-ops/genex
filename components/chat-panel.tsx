"use client";

import type { JSX } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useMemo, useState } from "react";

import { readGuestCreditsRemaining } from "@/lib/guest-credits";
import { Button } from "@/components/ui/button";

function textFromParts(message: UIMessage) {
  return message.parts
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

export function ChatPanel(): JSX.Element {
  const [input, setInput] = useState("");
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        credentials: "same-origin",
        body: () => ({
          inputMode: "generate_first" as const,
          guestCreditsRemaining: readGuestCreditsRemaining(),
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, stop } = useChat({
    transport,
  });

  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
      <div className="min-h-[200px] space-y-3 text-sm">
        {messages.length === 0 ? (
          <p className="text-muted-foreground">
            Add your <code className="text-xs">OPENAI_API_KEY</code>, then try a
            message. Responses stream from{" "}
            <code className="text-xs">/api/chat</code>.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "user"
                  ? "ml-8 rounded-lg bg-muted px-3 py-2"
                  : "mr-8 rounded-lg border border-border bg-background px-3 py-2"
              }
            >
              <p className="whitespace-pre-wrap">{textFromParts(m)}</p>
            </div>
          ))
        )}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = input.trim();
          if (!text || busy) return;
          void sendMessage({ text });
          setInput("");
        }}
      >
        <input
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring/50 focus-visible:ring-[3px]"
          value={input}
          placeholder="Message…"
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        {busy ? (
          <Button type="button" variant="secondary" onClick={() => void stop()}>
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={!input.trim()}>
            Send
          </Button>
        )}
      </form>
    </div>
  );
}
