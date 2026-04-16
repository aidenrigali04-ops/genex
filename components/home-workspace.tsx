"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { User } from "lucide-react";

import { signInWithGoogle, signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  parseFormatTagsFromCreatorSignals,
} from "@/lib/clip-package";
import { MAX_CLIP_SOURCE_CHARS } from "@/lib/clip-model-input";
import {
  FREE_DAILY_CREDITS,
  isUnlimitedCreditsModeClient,
  UNLIMITED_CREDITS_SENTINEL,
} from "@/lib/credits-config";
import { type GenerationPresetId } from "@/lib/generation-presets";
import { isEmptyStoredClipPackageV1 } from "@/lib/generation-output";
import { decrementGuestCredit, readGuestCreditsRemaining } from "@/lib/guest-credits";
import { extractPlatformSection } from "@/lib/parse-generation-output";
import { MAX_MEDIA_UPLOAD_BYTES } from "@/lib/media-upload-limits";
import { isYoutubeVideoUrlForTranscript } from "@/lib/youtube-url";
import { type PlatformId } from "@/lib/platforms";
import { VideoVariationWorkspace } from "@/components/video-variation-workspace";
import { cn } from "@/lib/utils";

const CLIP_PLATFORMS: PlatformId[] = ["clip_package"];

const PRESET_CHIPS: {
  id: GenerationPresetId;
  emoji: string;
  label: string;
}[] = [
  { id: "viral_hook", emoji: "⚡", label: "Viral Hook" },
  { id: "storytime", emoji: "📖", label: "Storytime" },
  { id: "educational", emoji: "💡", label: "Educational" },
  { id: "contrarian", emoji: "🔥", label: "Contrarian" },
];

export type ClipPackageHistoryItem = {
  id: string;
  createdAt: string;
  inputText: string | null;
  inputUrl: string | null;
  output: string;
  platforms: PlatformId[];
};

type HomeWorkspaceProps = {
  initialUser: { id: string; email: string } | null;
  initialCreditsRemaining: number | null;
  initialClipPackages: ClipPackageHistoryItem[];
  totalClipCount: number;
  /** Server GENEX_UNLIMITED_CREDITS — skips RPC; use with NEXT_PUBLIC for guests. */
  unlimitedCredits?: boolean;
  authError?: string | null;
};

export function HomeWorkspace({
  initialUser,
  initialCreditsRemaining,
  initialClipPackages,
  totalClipCount,
  unlimitedCredits = false,
  authError,
}: HomeWorkspaceProps) {
  const router = useRouter();
  const creditsUnlimited =
    unlimitedCredits || isUnlimitedCreditsModeClient();
  const [user, setUser] = useState(initialUser);
  const [creditsRemaining, setCreditsRemaining] = useState<number>(() => {
    if (creditsUnlimited) return UNLIMITED_CREDITS_SENTINEL;
    if (initialCreditsRemaining != null) return initialCreditsRemaining;
    return FREE_DAILY_CREDITS;
  });

  const [signInOpen, setSignInOpen] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<"video" | "clip">("video");
  const [inputMode, setInputMode] = useState<"text" | "url" | "file">("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preset, setPreset] = useState<GenerationPresetId | null>(null);
  const [streamedText, setStreamedText] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchingYoutubeTranscript, setFetchingYoutubeTranscript] =
    useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(authError ?? null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [clips, setClips] = useState(initialClipPackages);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setUser(initialUser);
    const unlimited =
      unlimitedCredits || isUnlimitedCreditsModeClient();
    if (unlimited) {
      setCreditsRemaining(UNLIMITED_CREDITS_SENTINEL);
    } else if (initialCreditsRemaining != null) {
      setCreditsRemaining(initialCreditsRemaining);
    } else {
      setCreditsRemaining(readGuestCreditsRemaining());
    }
    setClips(initialClipPackages);
  }, [
    initialUser,
    initialCreditsRemaining,
    initialClipPackages,
    unlimitedCredits,
  ]);

  useEffect(() => {
    if (user) setSignInOpen(false);
  }, [user]);

  const clipPackageBody = useMemo(() => {
    const extracted = extractPlatformSection(
      streamedText,
      "clip_package",
      CLIP_PLATFORMS,
    );
    if (extracted.trim()) return extracted;
    if (/TOP CLIP MOMENTS/i.test(streamedText)) return streamedText.trim();
    return "";
  }, [streamedText]);

  const parsedClipPackage = useMemo(
    () => parseClipPackageSections(clipPackageBody),
    [clipPackageBody],
  );

  const verticalPreviewText = useMemo(() => {
    const script = parsedClipPackage.script.trim();
    if (script) return script;
    const pack = clipPackageBody.trim();
    if (pack) return pack;
    const stitched = [parsedClipPackage.moments, parsedClipPackage.hooks, parsedClipPackage.cta]
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n\n");
    if (stitched) return stitched;
    const raw = streamedText.trim();
    if (raw && !isEmptyStoredClipPackageV1(raw)) return raw;
    return "";
  }, [clipPackageBody, parsedClipPackage, streamedText]);

  const clipFormatTags = useMemo(
    () => parseFormatTagsFromCreatorSignals(parsedClipPackage.creator_signals),
    [parsedClipPackage.creator_signals],
  );

  const runGeneration = useCallback(async () => {
    setError(null);
    setCopiedId(null);

    if (inputMode === "text" && !text.trim()) {
      setError("Paste an idea, transcript, or notes.");
      return;
    }
    if (inputMode === "url" && !url.trim()) {
      setError("Enter a URL.");
      return;
    }
    if (inputMode === "file" && !uploadFile) {
      setError("Choose a file.");
      return;
    }

    if (!user && !creditsUnlimited) {
      const g = readGuestCreditsRemaining();
      if (g <= 0) {
        setBuyOpen(true);
        setError("You've used your free generations today.");
        return;
      }
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    setLoading(true);
    setProgress(8);
    setStreamedText("");

    try {
      let res: Response;
      const presetPart = preset ? { preset } : {};

      if (inputMode === "file" && uploadFile) {
        res = await fetch("/api/generate", {
          method: "POST",
          credentials: "same-origin",
          signal,
          body: (() => {
            const fd = new FormData();
            fd.append("file", uploadFile);
            fd.append("platforms", JSON.stringify(CLIP_PLATFORMS));
            if (preset) fd.append("preset", preset);
            return fd;
          })(),
        });
      } else if (
        inputMode === "url" &&
        isYoutubeVideoUrlForTranscript(url.trim())
      ) {
        let transcriptFromPrefetch = "";
        setFetchingYoutubeTranscript(true);
        setProgress(10);
        try {
          const trRes = await fetch("/api/youtube-transcript", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify({ url: url.trim() }),
          });
          if (trRes.ok) {
            const data = (await trRes.json()) as { transcript?: string };
            transcriptFromPrefetch =
              typeof data.transcript === "string" ? data.transcript.trim() : "";
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") throw e;
        } finally {
          setFetchingYoutubeTranscript(false);
        }

        setProgress(16);
        if (transcriptFromPrefetch) {
          const maxChars = MAX_CLIP_SOURCE_CHARS;
          const capped =
            transcriptFromPrefetch.length > maxChars
              ? `${transcriptFromPrefetch.slice(0, maxChars)}\n\n[Truncated to ${maxChars.toLocaleString()} characters for generation.]`
              : transcriptFromPrefetch;
          res = await fetch("/api/generate", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify({
              mode: "text",
              text: capped,
              sourceUrl: url.trim(),
              platforms: CLIP_PLATFORMS,
              ...presetPart,
            }),
          });
        } else {
          res = await fetch("/api/generate", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify({
              mode: "url",
              url: url.trim(),
              platforms: CLIP_PLATFORMS,
              ...presetPart,
            }),
          });
        }
      } else {
        res = await fetch("/api/generate", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            mode: inputMode,
            text: inputMode === "text" ? text : undefined,
            url: inputMode === "url" ? url : undefined,
            platforms: CLIP_PLATFORMS,
            ...presetPart,
          }),
        });
      }

      if (!res.ok) {
        const raw = await res.text();
        let message = raw || res.statusText;
        let noCredits = false;
        try {
          const j = JSON.parse(raw) as {
            error?: string;
            message?: string;
          };
          if (j.error === "no_credits") {
            noCredits = true;
            message = j.message ?? "You've used your free generations today.";
          } else if (j.message) message = j.message;
          else if (j.error) message = j.error;
        } catch {
          /* keep */
        }
        if (noCredits) {
          setBuyOpen(true);
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

      if (!user && !creditsUnlimited) {
        decrementGuestCredit();
        setCreditsRemaining(readGuestCreditsRemaining());
      }

      if (!accumulated.trim()) {
        setError(
          "No text came back from the model. Check the browser Network tab for /api/generate, confirm OPENAI_API_KEY on the server, and try again.",
        );
      }

      router.refresh();
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setError("Cancelled.");
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    } finally {
      setFetchingYoutubeTranscript(false);
      setLoading(false);
      setTimeout(() => setProgress(0), 400);
    }
  }, [
    creditsUnlimited,
    inputMode,
    preset,
    router,
    text,
    url,
    uploadFile,
    user,
  ]);

  const copyText = async (id: string, body: string) => {
    try {
      await navigator.clipboard.writeText(body);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError("Could not copy.");
    }
  };

  const canSubmit =
    inputMode === "text"
      ? Boolean(text.trim())
      : inputMode === "url"
        ? Boolean(url.trim())
        : Boolean(uploadFile);

  const myClipCards = useMemo(
    () =>
      clips.map((clip) => {
        const fallback =
          clip.inputText?.slice(0, 80) ??
          clip.inputUrl ??
          "Saved clip";
        return { ...clip, title: deriveClipTitle(clip.output, fallback) };
      }),
    [clips],
  );

  const openClip = (clip: ClipPackageHistoryItem) => {
    setStreamedText(clip.output);
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
      document.getElementById("output-section")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const initials =
    user?.email?.trim().charAt(0).toUpperCase() ??
    user?.email?.slice(0, 2).toUpperCase() ??
    "?";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border/80 bg-background/80 supports-backdrop-filter:backdrop-blur-md sticky top-0 z-40 border-b px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <span className="text-lg font-semibold tracking-tight">Genex</span>
          <div className="flex flex-1 justify-end items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setBuyOpen(true)}
              className={cn(
                "border-border bg-muted/60 hover:bg-muted rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                !creditsUnlimited &&
                  creditsRemaining <= 0 &&
                  "border-destructive/50 text-destructive",
              )}
            >
              {creditsUnlimited
                ? "⚡ Unlimited (test)"
                : `⚡ ${creditsRemaining} credits remaining`}
            </button>
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-9 rounded-full font-semibold"
                  >
                    {initials}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <div className="text-muted-foreground px-2 py-1.5 text-xs">
                    {user.email}
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setBuyOpen(true)}>
                    Buy credits
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void signOut()}>
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => setSignInOpen(true)}
              >
                <User className="size-4" />
                Sign in
              </Button>
            )}
          </div>
        </div>
      </header>

      <main
        className={cn(
          "mx-auto w-full flex-1 px-4 py-10 pb-20",
          workspaceTab === "video" ? "max-w-6xl space-y-8" : "max-w-3xl space-y-12",
        )}
      >
        <div className="border-border/80 flex flex-wrap gap-2 border-b pb-4">
          <Button
            type="button"
            variant={workspaceTab === "video" ? "default" : "ghost"}
            size="sm"
            onClick={() => setWorkspaceTab("video")}
          >
            Video AI editor
          </Button>
          <Button
            type="button"
            variant={workspaceTab === "clip" ? "default" : "ghost"}
            size="sm"
            onClick={() => setWorkspaceTab("clip")}
          >
            Clip package (text)
          </Button>
        </div>

        {workspaceTab === "video" ? (
          <VideoVariationWorkspace
            user={user}
            creditsRemaining={creditsRemaining}
            creditsUnlimited={creditsUnlimited}
            setCreditsRemaining={setCreditsRemaining}
            onOpenBuy={() => setBuyOpen(true)}
            onOpenSignIn={() => setSignInOpen(true)}
            onJobFinished={() => void router.refresh()}
          />
        ) : (
          <>
        <section className="space-y-6">
          <div className="space-y-3 text-center sm:text-left">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Turn any content into viral clips
            </h1>
            <p className="text-muted-foreground text-base sm:text-lg">
              Paste a YouTube URL, idea, or transcript. Get a full short-form
              clip package in seconds.
            </p>
          </div>

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
              Text / idea
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
              URL
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
            <textarea
              className="border-input bg-background ring-ring/50 focus-visible:ring-[3px] min-h-[200px] w-full resize-y rounded-xl border px-4 py-3 text-base outline-none"
              placeholder="Paste your transcript, talking points, or rough idea…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={loading}
            />
          ) : inputMode === "url" ? (
            <div className="space-y-2">
              <input
                type="url"
                className="border-input bg-background ring-ring/50 focus-visible:ring-[3px] h-12 w-full rounded-xl border px-4 text-base outline-none"
                placeholder="https://youtube.com/watch?v=… or any article URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading}
              />
              <p className="text-muted-foreground text-xs">
                YouTube watch and youtu.be links load captions first when possible.
              </p>
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border border-dashed p-4">
              <p className="text-muted-foreground text-sm">
                Video/audio (Whisper, max{" "}
                {Math.round(MAX_MEDIA_UPLOAD_BYTES / (1024 * 1024))} MB) or .txt /
                .md / .srt / .vtt
              </p>
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                accept=".flac,.m4a,.mp3,.mp4,.mpeg,.mpga,.mov,.m4v,.oga,.ogg,.wav,.webm,.txt,.md,.markdown,.csv,.srt,.vtt,.json"
                disabled={loading}
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
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
                <span className="text-muted-foreground truncate text-sm">
                  {uploadFile?.name ?? "No file selected"}
                </span>
                {uploadFile ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setUploadFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Style (one optional)
            </p>
            <div className="flex flex-wrap gap-2">
              {PRESET_CHIPS.map(({ id, emoji, label }) => (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={preset === id ? "default" : "outline"}
                  disabled={loading}
                  onClick={() => setPreset((cur) => (cur === id ? null : id))}
                  className="rounded-full"
                >
                  <span className="mr-1">{emoji}</span>
                  {label}
                </Button>
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
              <Progress
                value={fetchingYoutubeTranscript ? 18 : progress}
                className="w-full"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <ProgressLabel>
                    {fetchingYoutubeTranscript ? "YouTube" : "Generating"}
                  </ProgressLabel>
                  <ProgressValue />
                </div>
              </Progress>
              <p className="text-muted-foreground text-xs">
                {fetchingYoutubeTranscript
                  ? "Fetching captions…"
                  : "Streaming your clip package…"}
              </p>
            </div>
          ) : null}

          <Button
            type="button"
            className="h-12 w-full rounded-xl text-base sm:h-11"
            disabled={loading || !canSubmit}
            onClick={() => void runGeneration()}
          >
            {loading
              ? fetchingYoutubeTranscript
                ? "Fetching transcript…"
                : "Generating…"
              : "Generate Clip Package"}
          </Button>
        </section>

        {(streamedText.trim() || loading) && (
          <section id="output-section" className="scroll-mt-24 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-xl font-semibold">Your clip package</h2>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={loading || !canSubmit}
                onClick={() => void runGeneration()}
              >
                Regenerate
              </Button>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  TikTok · Reels · Shorts
                </span>
                {clipFormatTags.map((tag) => (
                  <span
                    key={tag}
                    className="bg-secondary text-secondary-foreground rounded-full px-2.5 py-0.5 text-xs font-medium"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mx-auto w-[min(100%,240px)] rounded-[2rem] border-4 border-zinc-800 bg-zinc-950 p-2">
                <div className="aspect-9/16 min-h-[200px] overflow-y-auto rounded-[1.5rem] bg-zinc-950 p-3 text-[12px] leading-snug text-zinc-100">
                  <p className="mb-2 text-[10px] tracking-wide text-zinc-500 uppercase">
                    9:16 preview
                  </p>
                  <pre className="font-sans wrap-break-word whitespace-pre-wrap">
                    {verticalPreviewText.trim()
                      ? verticalPreviewText
                      : loading
                        ? "Streaming…"
                        : "Script appears here."}
                  </pre>
                </div>
              </div>

              <div className="grid gap-3">
                {CLIP_SECTIONS.map((section) => {
                  const block = parsedClipPackage[section.id];
                  return (
                    <Card key={section.id} size="sm">
                      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                        <CardTitle className="text-base">{section.label}</CardTitle>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={!block}
                          onClick={() => void copyText(section.id, block)}
                        >
                          {copiedId === section.id ? "Copied" : "Copy"}
                        </Button>
                      </CardHeader>
                      <CardContent>
                        <pre className="font-sans text-sm whitespace-pre-wrap wrap-break-word">
                          {block ||
                            (loading ? "Waiting…" : "No content yet.")}
                        </pre>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <section className="space-y-4 border-t border-border pt-12">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold">My Clips</h2>
            {user && totalClipCount > 5 ? (
              <span className="text-muted-foreground text-sm">View all — coming soon</span>
            ) : null}
          </div>
          {!user ? (
            <Card size="sm">
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-sm">
                  Sign in to save and access your clip history across devices.
                </p>
                <Button
                  variant="link"
                  className="mt-2 h-auto px-0"
                  onClick={() => setSignInOpen(true)}
                >
                  Sign in
                </Button>
              </CardContent>
            </Card>
          ) : myClipCards.length === 0 ? (
            <p className="text-muted-foreground text-sm">No saved clips yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {myClipCards.map((clip) => (
                <Card key={clip.id} size="sm">
                  <CardHeader>
                    <CardTitle className="text-base">{clip.title}</CardTitle>
                    <CardDescription>
                      {new Date(clip.createdAt).toLocaleString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground line-clamp-2 text-sm">
                      {(clip.inputText ?? clip.inputUrl ?? "")
                        .replace(/\s+/g, " ")
                        .slice(0, 120)}
                    </p>
                  </CardContent>
                  <CardFooter>
                    <Button type="button" size="sm" onClick={() => openClip(clip)}>
                      Open
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </section>
          </>
        )}
      </main>

      <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sign in</DialogTitle>
            <DialogDescription>
              Sign in to save your clips and buy more credits.
            </DialogDescription>
          </DialogHeader>
          <form action={signInWithGoogle} className="space-y-3">
            <input type="hidden" name="next" value="/" />
            <Button type="submit" className="w-full">
              Continue with Google
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <BuyCreditsDialog
        open={buyOpen}
        onOpenChange={setBuyOpen}
        creditsRemaining={creditsRemaining}
        creditsUnlimited={creditsUnlimited}
      />
    </div>
  );
}

function BuyCreditsDialog({
  open,
  onOpenChange,
  creditsRemaining,
  creditsUnlimited,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  creditsRemaining: number;
  creditsUnlimited: boolean;
}) {
  const [email, setEmail] = useState("");
  const [waitStatus, setWaitStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitWaitlist = async () => {
    setWaitStatus(null);
    if (!email.trim()) {
      setWaitStatus("Enter your email.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setWaitStatus(j.error ?? "Could not save.");
        return;
      }
      setWaitStatus("You're on the list. We'll be in touch.");
      setEmail("");
    } catch {
      setWaitStatus("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upgrade & credits</DialogTitle>
          <DialogDescription>
            {creditsUnlimited ? (
              <>
                Test mode: <strong>unlimited</strong> credits. Stripe
                integration coming soon — join the waitlist below.
              </>
            ) : (
              <>
                You have <strong>{creditsRemaining}</strong> free credits left
                today. Stripe integration coming soon — join the waitlist below.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { name: "Starter", credits: "30 credits", price: "$5" },
            { name: "Creator", credits: "100 credits", price: "$12" },
            { name: "Pro", credits: "Unlimited / mo", price: "$29/mo" },
          ].map((p) => (
            <Card key={p.name} size="sm">
              <CardHeader>
                <CardTitle className="text-base">{p.name}</CardTitle>
                <CardDescription>
                  {p.credits} — {p.price}
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button type="button" className="w-full" disabled>
                  Coming soon
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>

        <div className="border-border space-y-2 rounded-lg border border-dashed p-4">
          <Label htmlFor="waitlist-email">Notify me at</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="waitlist-email"
              type="email"
              className="border-input bg-background flex-1 rounded-md border px-3 py-2 text-sm outline-none"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button type="button" disabled={busy} onClick={() => void submitWaitlist()}>
              Notify me
            </Button>
          </div>
          {waitStatus ? (
            <p className="text-muted-foreground text-xs">{waitStatus}</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
