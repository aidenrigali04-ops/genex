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
  estimateClipDurationSeconds,
  parseClipPackageSections,
  parseFormatTagsFromCreatorSignals,
  parseLengthHintSeconds,
} from "@/lib/clip-package";
import { isEmptyStoredClipPackageV1 } from "@/lib/generation-output";
import { extractPlatformSection } from "@/lib/parse-generation-output";
import { MAX_MEDIA_UPLOAD_BYTES } from "@/lib/source-from-upload";
import {
  isPlatformId,
  PLATFORM_DEFS,
  type PlatformDefinition,
  type PlatformId,
} from "@/lib/platforms";
import { cn } from "@/lib/utils";

type InputMode = "text" | "url" | "file";

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
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const clipPackageBody = useMemo(() => {
    if (!includesClipPackage) return "";
    const extracted = extractPlatformSection(
      streamedText,
      "clip_package",
      selectedOrdered,
    );
    if (extracted.trim()) return extracted;
    // Saved rows or older outputs: inner package without outer ### header
    if (/TOP CLIP MOMENTS/i.test(streamedText)) return streamedText.trim();
    return "";
  }, [includesClipPackage, selectedOrdered, streamedText]);
  const parsedClipPackage = useMemo(
    () => parseClipPackageSections(clipPackageBody),
    [clipPackageBody],
  );

  /** Phone frame: prefer parsed script, then any clip markdown, then partial sections, then raw stream. */
  const verticalPreviewText = useMemo(() => {
    const script = parsedClipPackage.script.trim();
    if (script) return script;

    const pack = clipPackageBody.trim();
    if (pack) return pack;

    const stitched = [
      parsedClipPackage.moments,
      parsedClipPackage.hooks,
      parsedClipPackage.cta,
    ]
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n\n");
    if (stitched) return stitched;

    if (includesClipPackage) {
      const raw = streamedText.trim();
      if (raw && !isEmptyStoredClipPackageV1(raw)) return raw;
    }

    return "";
  }, [
    clipPackageBody,
    includesClipPackage,
    parsedClipPackage.cta,
    parsedClipPackage.hooks,
    parsedClipPackage.moments,
    parsedClipPackage.script,
    streamedText,
  ]);

  const clipDurationEstimate = useMemo(
    () => estimateClipDurationSeconds(parsedClipPackage.script),
    [parsedClipPackage.script],
  );

  const clipFormatTags = useMemo(
    () => parseFormatTagsFromCreatorSignals(parsedClipPackage.creator_signals),
    [parsedClipPackage.creator_signals],
  );

  const clipLengthHintSeconds = useMemo(
    () => parseLengthHintSeconds(parsedClipPackage.creator_signals),
    [parsedClipPackage.creator_signals],
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

    if (inputMode === "file" && !uploadFile) {
      setError("Choose a video, audio, or text file.");
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    setLoading(true);
    setProgress(8);
    setStreamedText("");

    try {
      const res =
        inputMode === "file" && uploadFile
          ? await fetch("/api/generate", {
              method: "POST",
              credentials: "same-origin",
              signal,
              body: (() => {
                const fd = new FormData();
                fd.append("file", uploadFile);
                fd.append("platforms", JSON.stringify(selectedOrdered));
                return fd;
              })(),
            })
          : await fetch("/api/generate", {
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
        if (!accumulated.trim()) {
          setError(
            "No text came back from the model stream. Check OPENAI_API_KEY and try Regenerate.",
          );
        }
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
  }, [inputMode, router, selectedOrdered, text, url, uploadFile]);

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
    (inputMode === "text"
      ? Boolean(text.trim())
      : inputMode === "url"
        ? Boolean(url.trim())
        : Boolean(uploadFile));
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
    const restoredPlatforms = (clip.platforms ?? []).filter(
      (p): p is PlatformId => isPlatformId(p),
    );
    const mergedPlatforms: PlatformId[] = restoredPlatforms.includes(
      "clip_package",
    )
      ? restoredPlatforms
      : [...restoredPlatforms, "clip_package"];

    setStreamedText(clip.output);
    setSelected(selectionFromPlatforms(mergedPlatforms));
    setUploadFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (clip.inputUrl?.startsWith("file:")) {
      setInputMode("text");
      setText(clip.inputText ?? "");
      setUrl("");
    } else if (clip.inputUrl) {
      setInputMode("url");
      setUrl(clip.inputUrl);
      setText("");
    } else {
      setInputMode("text");
      setText(clip.inputText ?? "");
      setUrl("");
    }
    setError(null);

    requestAnimationFrame(() => {
      document
        .getElementById("clip-viewer-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
              Paste text, fetch a URL, or upload a file. Video and audio are
              transcribed on the server; text files are read as UTF-8.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={inputMode === "text" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setInputMode("text");
                  setUploadFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                disabled={loading}
              >
                Paste text
              </Button>
              <Button
                type="button"
                variant={inputMode === "url" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setInputMode("url");
                  setUploadFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                disabled={loading}
              >
                From URL
              </Button>
              <Button
                type="button"
                variant={inputMode === "file" ? "default" : "outline"}
                size="sm"
                onClick={() => setInputMode("file")}
                disabled={loading}
              >
                Upload file
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
            ) : inputMode === "url" ? (
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
            ) : (
              <div className="space-y-2">
                <Label htmlFor="source-file">Video, audio, or text file</Label>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Supported: common video/audio (transcribed with Whisper, max{" "}
                  {Math.round(MAX_MEDIA_UPLOAD_BYTES / (1024 * 1024))} MB), or
                  plain text formats (.txt, .md, .srt, .vtt, .csv). Large
                  transcripts may be truncated for generation.
                </p>
                <input
                  ref={fileInputRef}
                  id="source-file"
                  type="file"
                  className="sr-only"
                  accept="audio/*,video/*,.txt,.md,.markdown,.csv,.srt,.vtt,.json,.mp3,.mp4,.m4a,.wav,.webm,.mov,.mpeg,.mpga,.ogg,.flac"
                  disabled={loading}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setUploadFile(f);
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose file
                  </Button>
                  <span className="text-muted-foreground max-w-[min(100%,280px)] truncate text-sm">
                    {uploadFile ? uploadFile.name : "No file selected"}
                  </span>
                  {uploadFile ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={loading}
                      onClick={() => {
                        setUploadFile(null);
                        if (fileInputRef.current)
                          fileInputRef.current.value = "";
                      }}
                    >
                      Clear
                    </Button>
                  ) : null}
                </div>
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
                  {inputMode === "file"
                    ? "Transcribing your file if needed, then streaming the response…"
                    : "Streaming response in real-time…"}
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

        <section id="clip-viewer-panel" className="scroll-mt-8 space-y-4">
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
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                    <span className="inline-flex w-fit items-center rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      Optimized for TikTok · Reels · Shorts
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-2 text-xs text-muted-foreground sm:items-end">
                      {clipDurationEstimate.wordCount > 0 ? (
                        <span className="text-right">
                          ~{clipDurationEstimate.seconds}s est. read-aloud (
                          {clipDurationEstimate.wordCount} spoken words tagged{" "}
                          <span className="font-mono">[LINE]</span>)
                        </span>
                      ) : streamedText.trim() && !loading ? (
                        <span className="text-right">
                          Length estimate appears once the script includes{" "}
                          <span className="font-mono">[LINE]</span> beats.
                        </span>
                      ) : null}
                      {clipLengthHintSeconds != null ? (
                        <span className="rounded-md bg-muted px-2 py-1 text-right font-medium text-foreground">
                          Model length hint: ~{clipLengthHintSeconds}s
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {clipFormatTags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {clipFormatTags.map((tag) => (
                        <span
                          key={tag}
                          className="bg-secondary text-secondary-foreground rounded-full px-2.5 py-0.5 text-xs font-medium"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mx-auto w-[220px] max-w-full rounded-[2.1rem] border-4 border-zinc-900 bg-zinc-950 p-2 shadow-lg dark:border-zinc-700">
                    <div className="aspect-[9/16] min-h-[200px] overflow-y-auto rounded-[1.5rem] bg-zinc-950 p-3 text-[12px] leading-snug text-zinc-100">
                      <p className="mb-2 text-[10px] tracking-wide text-zinc-400 uppercase">
                        Vertical Preview
                      </p>
                      <pre className="font-sans wrap-break-word whitespace-pre-wrap text-zinc-100">
                        {verticalPreviewText.trim()
                          ? verticalPreviewText
                          : loading
                            ? "Streaming clip package…"
                            : "Clip script will appear here once the model emits the clip section. If a saved clip shows this message, that row has no stored text—generate again (older empty saves cannot be recovered)."}
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
