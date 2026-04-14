"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import {
  CLIP_SECTIONS,
  deriveClipTitle,
  parseClipPackageSections,
} from "@/lib/clip-package";
import { extractPlatformSection } from "@/lib/parse-generation-output";
import {
  PLATFORM_DEFS,
  type PlatformDefinition,
  type PlatformId,
} from "@/lib/platforms";
import { cn } from "@/lib/utils";

type InputMode = "text" | "url";

type ClipPackageHistoryItem = {
  id: string;
  createdAt: string;
  inputText: string | null;
  inputUrl: string | null;
  output: string;
  platforms: PlatformId[];
};

type DashboardClientProps = {
  initialUser: { id: string; email: string };
  initialClipPackages: ClipPackageHistoryItem[];
};

const emptySelection = (): Record<PlatformId, boolean> =>
  PLATFORM_DEFS.reduce(
    (acc, p) => {
      acc[p.id] = false;
      return acc;
    },
    {} as Record<PlatformId, boolean>,
  );

function selectionFromPlatforms(
  platforms: PlatformId[],
): Record<PlatformId, boolean> {
  const base = emptySelection();
  for (const id of platforms) {
    if (id in base) base[id] = true;
  }
  return base;
}

export function DashboardClient({
  initialUser,
  initialClipPackages,
}: DashboardClientProps) {
  const router = useRouter();
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
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const selectedOrdered = useMemo(
    () => PLATFORM_DEFS.filter((p) => selected[p.id]).map((p) => p.id),
    [selected],
  );
  const includesClipPackage = selectedOrdered.includes("clip_package");
  const clipPackageBody = useMemo(
    () =>
      includesClipPackage
        ? extractPlatformSection(streamedText, "clip_package", selectedOrdered)
        : "",
    [includesClipPackage, selectedOrdered, streamedText],
  );
  const parsedClipPackage = useMemo(
    () => parseClipPackageSections(clipPackageBody),
    [clipPackageBody],
  );

  const togglePlatform = useCallback((id: PlatformId, checked: boolean) => {
    setSelected((prev) => ({ ...prev, [id]: checked }));
  }, []);

  const runGeneration = useCallback(async () => {
    setError(null);
    setCopiedId(null);

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
        if (res.status === 401) {
          setError(
            "Your session expired or you are not signed in. Open /login to sign in again.",
          );
        } else {
          setError(message || "Request failed");
        }
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
      if (selectedOrdered.includes("clip_package")) {
        router.refresh();
      }
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
  }, [inputMode, router, selectedOrdered, text, url]);

  const copyText = async (id: string, body: string) => {
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
    selectedOrdered.length > 0 &&
    (inputMode === "text" ? Boolean(text.trim()) : Boolean(url.trim()));
  const genericPlatformCards = platformCards.filter(
    (platform) => platform.id !== "clip_package",
  );

  const myClipCards = useMemo(
    () =>
      initialClipPackages.map((clip) => {
        const fallback =
          clip.inputText?.slice(0, 80) ??
          clip.inputUrl ??
          "Saved clip package";
        return {
          ...clip,
          title: deriveClipTitle(clip.output, fallback),
        };
      }),
    [initialClipPackages],
  );

  const openClip = (clip: ClipPackageHistoryItem) => {
    setStreamedText(clip.output);
    setSelected(selectionFromPlatforms(clip.platforms));
    if (clip.inputUrl) {
      setInputMode("url");
      setUrl(clip.inputUrl);
      setText("");
    } else {
      setInputMode("text");
      setText(clip.inputText ?? "");
      setUrl("");
    }
    setError(null);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Clip-first content repurposing for TikTok, Reels, and Shorts.
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Signed in as {initialUser.email}
          </p>
        </div>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Home
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Input panel</CardTitle>
            <CardDescription>
              Paste text or a URL and pick your destination formats.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={inputMode === "text" ? "default" : "outline"}
                size="sm"
                onClick={() => setInputMode("text")}
                disabled={loading}
              >
                Paste text
              </Button>
              <Button
                type="button"
                variant={inputMode === "url" ? "default" : "outline"}
                size="sm"
                onClick={() => setInputMode("url")}
                disabled={loading}
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
                  placeholder="Paste transcript, talking points, notes..."
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
                  placeholder="https://..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={loading}
                />
              </div>
            )}

            <div className="space-y-3">
              <p className="text-sm font-medium">Platforms</p>
              <div className="grid gap-3">
                {PLATFORM_DEFS.map((platform) => {
                  const highlighted = platform.id === "clip_package";
                  return (
                    <label
                      key={platform.id}
                      className={cn(
                        "hover:bg-muted/50 flex cursor-pointer items-start gap-2 rounded-md border px-2 py-2",
                        highlighted
                          ? "border-primary/40 bg-primary/5"
                          : "border-transparent",
                      )}
                    >
                      <Checkbox
                        checked={selected[platform.id]}
                        onCheckedChange={(checked) =>
                          togglePlatform(platform.id, Boolean(checked))
                        }
                        disabled={loading}
                      />
                      <span className="text-sm leading-tight">
                        {platform.label}
                      </span>
                    </label>
                  );
                })}
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
                  Streaming response in real-time...
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void runGeneration()}
                disabled={loading || !canSubmit}
              >
                {loading ? "Generating..." : "Generate"}
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

        <section className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Output / Clip Viewer</CardTitle>
              <CardDescription>
                Live stream output appears here while generation runs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!streamedText.trim() && !loading ? (
                <p className="text-muted-foreground text-sm">
                  Generate content to populate this panel.
                </p>
              ) : null}

              {includesClipPackage ? (
                <div className="space-y-4">
                  <div className="mx-auto w-[220px] max-w-full rounded-[2.1rem] border-4 border-zinc-900 bg-zinc-950 p-2 shadow-lg dark:border-zinc-700">
                    <div className="aspect-[9/16] overflow-y-auto rounded-[1.5rem] bg-black p-3 text-[11px] text-white">
                      <p className="mb-2 text-[10px] tracking-wide text-zinc-300 uppercase">
                        Vertical Preview
                      </p>
                      <pre className="font-sans whitespace-pre-wrap wrap-break-word">
                        {parsedClipPackage.script ||
                          clipPackageBody ||
                          "Clip script will stream here..."}
                      </pre>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {CLIP_SECTIONS.map((section) => {
                      const textBlock = parsedClipPackage[section.id];
                      return (
                        <Card key={section.id} size="sm">
                          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                            <CardTitle className="text-base">
                              {section.label}
                            </CardTitle>
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              disabled={!textBlock}
                              onClick={() => void copyText(section.id, textBlock)}
                            >
                              {copiedId === section.id ? "Copied" : "Copy"}
                            </Button>
                          </CardHeader>
                          <CardContent>
                            <pre className="font-sans text-sm whitespace-pre-wrap wrap-break-word">
                              {textBlock ||
                                (loading
                                  ? "Waiting for this section..."
                                  : "No content yet.")}
                            </pre>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-3">
                {genericPlatformCards.map((platform) => {
                  const body = extractPlatformSection(
                    streamedText,
                    platform.id,
                    selectedOrdered,
                  );
                  return (
                    <Card key={platform.id} size="sm">
                      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                        <CardTitle className="text-base">
                          {platform.label}
                        </CardTitle>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={!body}
                          onClick={() => void copyText(platform.id, body)}
                        >
                          {copiedId === platform.id ? "Copied" : "Copy"}
                        </Button>
                      </CardHeader>
                      <CardContent>
                        {body ? (
                          <pre className="font-sans text-sm whitespace-pre-wrap wrap-break-word">
                            {body}
                          </pre>
                        ) : (
                          <p className="text-muted-foreground text-sm">
                            {loading
                              ? "Waiting for this section..."
                              : "No content yet."}
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
            </CardContent>
          </Card>
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">My Clips</h2>
        {myClipCards.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No saved clip packages yet.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {myClipCards.map((clip) => (
              <Card key={clip.id} size="sm">
                <CardHeader>
                  <CardTitle className="text-base">{clip.title}</CardTitle>
                  <CardDescription>
                    {new Date(clip.createdAt).toLocaleString()}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-sm">
                    {(clip.inputText ?? clip.inputUrl ?? "Saved clip package")
                      .replace(/\s+/g, " ")
                      .slice(0, 120)}
                  </p>
                </CardContent>
                <CardFooter>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => openClip(clip)}
                  >
                    Open Clip
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
