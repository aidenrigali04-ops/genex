"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import { extractPlatformSection } from "@/lib/parse-generation-output";
import {
  PLATFORM_DEFS,
  type PlatformDefinition,
  type PlatformId,
} from "@/lib/platforms";
import { cn } from "@/lib/utils";

type InputMode = "text" | "url";

type DashboardClientProps = {
  initialUser: { id: string; email: string } | null;
};

const emptySelection = (): Record<PlatformId, boolean> =>
  PLATFORM_DEFS.reduce(
    (acc, p) => {
      acc[p.id] = false;
      return acc;
    },
    {} as Record<PlatformId, boolean>,
  );

export function DashboardClient({ initialUser }: DashboardClientProps) {
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<Record<PlatformId, boolean>>(
    emptySelection,
  );

  const [streamedText, setStreamedText] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<PlatformId | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const selectedOrdered = useMemo(
    () => PLATFORM_DEFS.filter((p) => selected[p.id]).map((p) => p.id),
    [selected],
  );

  const togglePlatform = useCallback((id: PlatformId, checked: boolean) => {
    setSelected((prev) => ({ ...prev, [id]: checked }));
  }, []);

  const runGeneration = useCallback(async () => {
    setError(null);
    setCopiedId(null);

    if (!initialUser) {
      setError("Sign in on the home page to generate content.");
      return;
    }

    if (selectedOrdered.length === 0) {
      setError("Select at least one platform.");
      return;
    }

    if (inputMode === "text" && !text.trim()) {
      setError("Paste some text to repurpose.");
      return;
    }

    if (inputMode === "url" && !url.trim()) {
      setError("Enter a URL to fetch content from.");
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    setLoading(true);
    setProgress(8);
    setStreamedText("");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          mode: inputMode,
          text: inputMode === "text" ? text : undefined,
          url: inputMode === "url" ? url : undefined,
          platforms: selectedOrdered,
        }),
      });

      if (!res.ok) {
        const raw = await res.text();
        let message = raw || res.statusText;
        try {
          const j = JSON.parse(raw) as { error?: string };
          if (j.error) message = j.error;
        } catch {
          /* keep message */
        }
        setError(message || "Request failed");
        setProgress(0);
        setLoading(false);
        return;
      }

      if (!res.body) {
        setError("No response body from server.");
        setProgress(0);
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          accumulated += decoder.decode(value, { stream: true });
          setStreamedText(accumulated);
          setProgress((p) => Math.min(92, p + 1.2));
        }
      }
      accumulated += decoder.decode();
      setStreamedText(accumulated);
      setProgress(100);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setError("Generation cancelled.");
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(0), 400);
    }
  }, [initialUser, inputMode, selectedOrdered, text, url]);

  const copySection = async (id: PlatformId, body: string) => {
    try {
      await navigator.clipboard.writeText(body);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError("Could not copy to clipboard.");
    }
  };

  const platformCards: PlatformDefinition[] = useMemo(
    () => PLATFORM_DEFS.filter((p) => selected[p.id]),
    [selected],
  );

  const canSubmit =
    Boolean(initialUser) &&
    selectedOrdered.length > 0 &&
    (inputMode === "text" ? Boolean(text.trim()) : Boolean(url.trim()));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Paste text or a URL, pick platforms, then generate repurposed
            content.
          </p>
          {initialUser ? (
            <p className="text-muted-foreground mt-1 text-xs">
              Signed in as {initialUser.email}
            </p>
          ) : (
            <p className="text-destructive mt-2 text-sm">
              You are not signed in.{" "}
              <Link href="/" className="text-primary underline-offset-4 hover:underline">
                Go home to sign in
              </Link>
              .
            </p>
          )}
        </div>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Home
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Content input</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={inputMode === "text" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setInputMode("text");
                setError(null);
              }}
            >
              Paste text
            </Button>
            <Button
              type="button"
              variant={inputMode === "url" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setInputMode("url");
                setError(null);
              }}
            >
              From URL
            </Button>
          </div>

          {inputMode === "text" ? (
            <div className="space-y-2">
              <Label htmlFor="source-text">Source text</Label>
              <textarea
                id="source-text"
                className="border-input bg-background ring-ring/50 focus-visible:ring-[3px] min-h-[220px] w-full resize-y rounded-md border px-3 py-2 text-sm outline-none"
                placeholder="Paste article, transcript, notes…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={loading}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="source-url">Page URL</Label>
              <input
                id="source-url"
                type="url"
                className="border-input bg-background ring-ring/50 focus-visible:ring-[3px] h-10 w-full rounded-md border px-3 text-sm outline-none"
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading}
              />
              <p className="text-muted-foreground text-xs">
                We fetch the page server-side and strip HTML to plain text (size
                limited). Some sites may block automated fetches.
              </p>
            </div>
          )}

          <div className="space-y-3">
            <p className="text-sm font-medium">Platforms</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {PLATFORM_DEFS.map((p) => (
                <label
                  key={p.id}
                  className="hover:bg-muted/50 flex cursor-pointer items-start gap-2 rounded-md border border-transparent px-1 py-1"
                >
                  <Checkbox
                    checked={selected[p.id]}
                    onCheckedChange={(checked) =>
                      togglePlatform(p.id, Boolean(checked))
                    }
                    disabled={loading}
                  />
                  <span className="text-sm leading-tight">{p.label}</span>
                </label>
              ))}
            </div>
          </div>

          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}

          {loading ? (
            <div className="space-y-2">
              <Progress value={progress} className="w-full">
                <div className="flex w-full items-center justify-between gap-2">
                  <ProgressLabel>Generating</ProgressLabel>
                  <ProgressValue />
                </div>
              </Progress>
              <p className="text-muted-foreground text-xs">
                Streaming from the model — cards update as each section arrives.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void runGeneration()}
              disabled={loading || !canSubmit}
            >
              {loading ? "Generating…" : "Generate"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void runGeneration()}
              disabled={loading || !canSubmit}
            >
              Regenerate
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Output</h2>
        {!loading && !streamedText.trim() && !error ? (
          <p className="text-muted-foreground text-sm">
            Generated content will appear here in separate cards as it streams.
          </p>
        ) : null}
        {platformCards.length === 0 && !loading ? (
          <p className="text-muted-foreground text-sm">
            Select at least one platform to see output cards.
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          {platformCards.map((p) => {
            const body = extractPlatformSection(
              streamedText,
              p.id,
              selectedOrdered,
            );
            return (
              <Card key={p.id} size="sm">
                <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                  <CardTitle className="text-base">{p.label}</CardTitle>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={!body}
                    onClick={() => void copySection(p.id, body)}
                  >
                    {copiedId === p.id ? "Copied" : "Copy"}
                  </Button>
                </CardHeader>
                <CardContent>
                  {body ? (
                    <pre className="font-sans text-sm whitespace-pre-wrap wrap-break-word">
                      {body}
                    </pre>
                  ) : loading ? (
                    <p className="text-muted-foreground text-sm italic">
                      Waiting for this section…
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      No content for this section yet. Try Regenerate or adjust
                      your selection.
                    </p>
                  )}
                </CardContent>
                {loading && !body ? (
                  <CardFooter className="text-muted-foreground text-xs">
                    Streaming in progress
                  </CardFooter>
                ) : null}
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
