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
import {
  createGenerationStreamParser,
  type GenerationUiStep,
} from "@/lib/generation-stream-protocol";
import { MAX_MEDIA_UPLOAD_BYTES } from "@/lib/media-upload-limits";
import { isYoutubeVideoUrlForTranscript } from "@/lib/youtube-url";
import { type PlatformId } from "@/lib/platforms";
import { GenerationFeedbackPanel } from "@/components/generation-feedback-panel";
import { Hero } from "@/components/genex/hero";
import { HowItWorks } from "@/components/genex/how-it-works";
import { PlatformsGrid } from "@/components/genex/platforms-grid";
import { SettingsRail } from "@/components/genex/settings-rail";
import { SiteFooter } from "@/components/genex/site-footer";
import { SiteNav } from "@/components/genex/site-nav";
import { WorkspaceChrome } from "@/components/genex/workspace-chrome";
import { RefinementChatDialog } from "@/components/refinement-chat-dialog";
import { VideoVariationWorkspace } from "@/components/video-variation-workspace";
import type { GenerationContextV1 } from "@/lib/generation-context";
import { isGenerationContextV1 } from "@/lib/generation-context";
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
  generationContext?: unknown | null;
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
  const [clipSettingsOpen, setClipSettingsOpen] = useState(false);
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
  const [generationSteps, setGenerationSteps] = useState<GenerationUiStep[]>(
    [],
  );
  const [error, setError] = useState<string | null>(authError ?? null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [clips, setClips] = useState(initialClipPackages);

  const abortRef = useRef<AbortController | null>(null);
  const pendingGenerationContextRef = useRef<GenerationContextV1 | null>(null);

  const [refinementOpen, setRefinementOpen] = useState(false);
  const [lastClipGenerationContext, setLastClipGenerationContext] =
    useState<GenerationContextV1 | null>(null);

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

    const generationContext = pendingGenerationContextRef.current;
    pendingGenerationContextRef.current = null;

    setLoading(true);
    setProgress(8);
    setGenerationSteps([]);
    setStreamedText("");

    try {
      let res: Response;
      const presetPart = preset ? { preset } : {};
      const gcPart =
        generationContext != null ? { generationContext } : {};

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
            if (generationContext) {
              fd.append("generationContext", JSON.stringify(generationContext));
            }
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
              ...gcPart,
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
              ...gcPart,
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
            ...gcPart,
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
      const parser = createGenerationStreamParser();
      let displayAccum = "";
      let streamFatal = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const r = parser.push(chunk);
          if (r.fatal) {
            const code = r.fatal.error ?? "";
            const msg =
              r.fatal.message ??
              (code === "no_credits"
                ? "You've used your available credits."
                : code || "Request failed.");
            if (code === "no_credits") setBuyOpen(true);
            setError(msg);
            setProgress(0);
            displayAccum = "";
            setStreamedText("");
            streamFatal = true;
            break;
          }
          if (r.steps.length) {
            setGenerationSteps((prev) => [...prev, ...r.steps]);
          }
          if (r.textDelta) {
            displayAccum += r.textDelta;
            setStreamedText(displayAccum);
            setProgress((prev) =>
              Math.max(
                prev,
                Math.min(
                  92,
                  14 +
                    Math.min(52, Math.floor(displayAccum.length / 90)),
                ),
              ),
            );
          }
        }
      }

      if (!streamFatal) {
        const finalChunk = decoder.decode();
        if (finalChunk) {
          const r3 = parser.push(finalChunk);
          if (r3.fatal) {
            const code = r3.fatal.error ?? "";
            const msg =
              r3.fatal.message ??
              (code === "no_credits"
                ? "You've used your available credits."
                : code || "Request failed.");
            if (code === "no_credits") setBuyOpen(true);
            setError(msg);
            setProgress(0);
            displayAccum = "";
            setStreamedText("");
            streamFatal = true;
          } else {
            if (r3.steps.length) {
              setGenerationSteps((prev) => [...prev, ...r3.steps]);
            }
            displayAccum += r3.textDelta;
            setStreamedText(displayAccum);
          }
        }
      }

      if (!streamFatal) {
        const tail = parser.end();
        if (tail.steps.length) {
          setGenerationSteps((prev) => [...prev, ...tail.steps]);
        }
        if (tail.textDelta) {
          displayAccum += tail.textDelta;
          setStreamedText(displayAccum);
        }
        setProgress(100);
      }

      if (!user && !creditsUnlimited && !streamFatal) {
        decrementGuestCredit();
        setCreditsRemaining(readGuestCreditsRemaining());
      }

      const accumulated = displayAccum;
      if (!streamFatal && !accumulated.trim()) {
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

  const clipOriginalPromptSummary = useMemo(() => {
    if (inputMode === "text") return text.trim();
    if (inputMode === "url") return url.trim();
    if (uploadFile) return `File: ${uploadFile.name}`;
    return "";
  }, [inputMode, text, url, uploadFile]);

  const openClip = (clip: ClipPackageHistoryItem) => {
    setStreamedText(clip.output);
    const gc = clip.generationContext;
    setLastClipGenerationContext(isGenerationContextV1(gc) ? gc : null);
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

  const clipPresetLabel = preset
    ? (PRESET_CHIPS.find((c) => c.id === preset)?.label ?? null)
    : null;
  const creditsLineForRail = creditsUnlimited
    ? "Unlimited (test)"
    : `${creditsRemaining} left`;

  const clipSettingsRail = (
    <SettingsRail
      mode="clip"
      platformLabel="TikTok · Reels · Shorts"
      presetLabel={clipPresetLabel}
      creditsLine={creditsLineForRail}
    />
  );

  const creditsPill = (
    <button
      type="button"
      onClick={() => setBuyOpen(true)}
      className={cn(
        "rounded-full border border-[#E8E4F8] bg-white px-3 py-1.5 text-sm font-semibold text-[#0F0A1E] shadow-sm transition hover:bg-[#FAFAFC] dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100",
        !creditsUnlimited &&
          creditsRemaining <= 0 &&
          "border-red-300 text-red-700 dark:border-red-500/40 dark:text-red-300",
      )}
    >
      {creditsUnlimited
        ? "⚡ Unlimited (test)"
        : `⚡ ${creditsRemaining} credits`}
    </button>
  );

  const accountMenu = user ? (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button
          variant="ghost"
          size="sm"
          className="size-9 rounded-full border border-[#E8E4F8] bg-white font-semibold shadow-sm dark:border-white/10 dark:bg-zinc-900"
        >
          {initials}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <div className="text-muted-foreground px-2 py-1.5 text-xs">{user.email}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setBuyOpen(true)}>Buy credits</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 rounded-full border border-transparent hover:border-[#E8E4F8]"
      onClick={() => setSignInOpen(true)}
    >
      <User className="size-4" />
      Sign in
    </Button>
  );

  const scrollToWorkspace = () => {
    document.getElementById("workspace")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const onVideoJobFinished = useCallback(() => {
    void router.refresh();
  }, [router]);

  const handleGetStarted = () => {
    if (user) scrollToWorkspace();
    else setSignInOpen(true);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteNav
        creditsPill={creditsPill}
        accountSection={accountMenu}
        onGetStarted={handleGetStarted}
      />

      <Hero isSignedIn={Boolean(user)} onPrimaryCta={handleGetStarted} />

      <section id="workspace" className="scroll-mt-24 px-4 py-10">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl border border-[#E8E4F8] bg-white shadow-[0_24px_80px_-24px_rgba(108,71,255,0.2)] dark:border-white/10 dark:bg-zinc-900">
          <WorkspaceChrome
            workspaceTab={workspaceTab}
            onWorkspaceTab={setWorkspaceTab}
            onUpgrade={() => setBuyOpen(true)}
            onPlayPreview={() => {
              const id = workspaceTab === "clip" ? "output-section" : "video-output";
              document.getElementById(id)?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            }}
            accountSection={user ? accountMenu : null}
          />
          <div className="p-4 sm:p-6 lg:p-8">
            {workspaceTab === "video" ? (
              <VideoVariationWorkspace
                hideMarketingTitle
                user={user}
                creditsRemaining={creditsRemaining}
                creditsUnlimited={creditsUnlimited}
                setCreditsRemaining={setCreditsRemaining}
                onOpenBuy={() => setBuyOpen(true)}
                onOpenSignIn={() => setSignInOpen(true)}
                onJobFinished={onVideoJobFinished}
              />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)_208px]">
                  <div className="space-y-6 lg:min-w-0">
                    <div className="flex justify-end lg:hidden">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full border-[#E8E4F8]"
                        onClick={() => setClipSettingsOpen(true)}
                      >
                        Settings
                      </Button>
                    </div>

                    <section className="space-y-6">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={inputMode === "text" ? "default" : "outline"}
                          size="sm"
                          className={cn(
                            inputMode === "text" &&
                              "bg-[#6C47FF] text-white hover:bg-[#5835E8] genex-cta-glow",
                          )}
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
                          className={cn(
                            inputMode === "url" &&
                              "bg-[#6C47FF] text-white hover:bg-[#5835E8] genex-cta-glow",
                          )}
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
                          className={cn(
                            inputMode === "file" &&
                              "bg-[#6C47FF] text-white hover:bg-[#5835E8] genex-cta-glow",
                          )}
                          onClick={() => setInputMode("file")}
                          disabled={loading}
                        >
                          Upload file
                        </Button>
                      </div>

                      {inputMode === "text" ? (
                        <textarea
                          className="min-h-[200px] w-full resize-y rounded-xl border border-[#E8E4F8] bg-white px-4 py-3 text-base text-[#0F0A1E] outline-none ring-[#6C47FF]/25 focus-visible:ring-[3px] dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100"
                          placeholder="Paste your transcript, talking points, or rough idea…"
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          disabled={loading}
                        />
                      ) : inputMode === "url" ? (
                        <div className="space-y-2">
                          <input
                            type="url"
                            className="h-12 w-full rounded-xl border border-[#E8E4F8] bg-white px-4 text-base outline-none ring-[#6C47FF]/25 focus-visible:ring-[3px] dark:border-white/10 dark:bg-zinc-950"
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
                        <div className="space-y-2 rounded-xl border border-dashed border-[#C4BAF0] bg-[#FAFAFC] p-4 dark:border-violet-500/25 dark:bg-zinc-900/40">
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
                              className={cn(
                                "rounded-full",
                                preset === id &&
                                  "bg-[#6C47FF] text-white hover:bg-[#5835E8] genex-cta-glow",
                              )}
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
                        <div className="space-y-3">
                          <Progress
                            value={fetchingYoutubeTranscript ? 18 : progress}
                            className="w-full"
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <ProgressLabel>
                                {fetchingYoutubeTranscript
                                  ? "YouTube"
                                  : generationSteps.at(-1)?.label ?? "Generating"}
                              </ProgressLabel>
                              <ProgressValue />
                            </div>
                          </Progress>
                          <p className="text-muted-foreground text-xs">
                            {fetchingYoutubeTranscript
                              ? "Fetching captions before generation…"
                              : generationSteps.length > 0
                                ? "Server steps stream first, then the model output appears in the preview."
                                : "Connecting to the server…"}
                          </p>
                          {generationSteps.length > 0 ? (
                            <ol className="max-h-48 list-inside list-decimal overflow-y-auto rounded-lg border border-[#E8E4F8] bg-[#FAFAFC] px-3 py-2 text-xs dark:border-white/10 dark:bg-zinc-900/50">
                              {generationSteps.map((s, i) => (
                                <li
                                  key={`${s.id}-${i}`}
                                  className={
                                    i === generationSteps.length - 1
                                      ? "text-foreground py-0.5 font-medium"
                                      : "text-muted-foreground py-0.5"
                                  }
                                >
                                  {s.label}
                                </li>
                              ))}
                            </ol>
                          ) : null}
                        </div>
                      ) : null}

                      <Button
                        type="button"
                        className="h-12 w-full rounded-xl bg-[#6C47FF] text-base font-semibold text-white shadow-md hover:bg-[#5835E8] genex-cta-glow sm:h-11"
                        disabled={loading || !canSubmit}
                        onClick={() => setRefinementOpen(true)}
                      >
                        {loading
                          ? fetchingYoutubeTranscript
                            ? "Fetching transcript…"
                            : "Generating…"
                          : "Generate Clip Package"}
                      </Button>

                      <RefinementChatDialog
                        open={refinementOpen}
                        onOpenChange={setRefinementOpen}
                        kind="text_generation"
                        platformIds={CLIP_PLATFORMS}
                        inputSummary={
                          inputMode === "text"
                            ? text.trim().slice(0, 120) || "Text / idea"
                            : inputMode === "url"
                              ? url.trim() || "URL"
                              : uploadFile
                                ? `File: ${uploadFile.name}`
                                : "Upload"
                        }
                        onConfirm={(ctx) => {
                          pendingGenerationContextRef.current = ctx;
                          setLastClipGenerationContext(ctx);
                          setRefinementOpen(false);
                          void runGeneration();
                        }}
                      />
                    </section>
                  </div>

                  <div className="min-w-0 space-y-4">
                    <div className="flex justify-center lg:justify-start">
                      <span className="inline-flex items-center gap-2 rounded-full border border-[#E8E4F8] bg-white px-3 py-1 text-xs font-medium text-[#6B6B8A] dark:border-white/10 dark:bg-zinc-900">
                        English · Casual tone
                      </span>
                    </div>

                    {(streamedText.trim() || loading) && (
                      <section id="output-section" className="scroll-mt-24 space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <h2 className="text-xl font-semibold text-[#0F0A1E] dark:text-white">
                            Your clip package
                          </h2>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="rounded-full border-[#E8E4F8]"
                            disabled={loading || !canSubmit}
                            onClick={() => setRefinementOpen(true)}
                          >
                            Regenerate
                          </Button>
                        </div>

                        <div className="space-y-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex rounded-full border border-[#6C47FF]/35 bg-[#6C47FF]/10 px-3 py-1 text-xs font-medium text-[#6C47FF]">
                              TikTok · Reels · Shorts
                            </span>
                            {clipFormatTags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-[#F0EFFE] px-2.5 py-0.5 text-xs font-medium text-[#0F0A1E] dark:bg-zinc-800 dark:text-zinc-200"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>

                          <div className="mx-auto w-[min(100%,240px)] rounded-[2rem] border-4 border-[#E8E4F8] bg-[#0F0A1E] p-2 dark:border-white/10">
                            <div
                              className={cn(
                                "relative aspect-9/16 min-h-[200px] overflow-y-auto rounded-[1.5rem] bg-zinc-950 p-3 text-[12px] leading-snug text-zinc-100",
                                loading && "genex-shimmer",
                              )}
                            >
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
                                <Card
                                  key={section.id}
                                  size="sm"
                                  className="border-[#E8E4F8] shadow-sm transition duration-200 hover:scale-[1.02] hover:shadow-md dark:border-white/10"
                                >
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
                                      {block || (loading ? "Waiting…" : "No content yet.")}
                                    </pre>
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </div>

                          {!loading && streamedText.trim() ? (
                            <GenerationFeedbackPanel
                              mode="clip"
                              originalPrompt={clipOriginalPromptSummary || "Clip package"}
                              generationContext={lastClipGenerationContext}
                              variationsOutput={streamedText}
                            />
                          ) : null}
                        </div>
                      </section>
                    )}
                  </div>

                  <div className="hidden lg:block lg:min-w-0">{clipSettingsRail}</div>
                </div>

                <Dialog open={clipSettingsOpen} onOpenChange={setClipSettingsOpen}>
                  <DialogContent
                    showCloseButton
                    className="fixed right-auto bottom-0 left-1/2 top-auto max-h-[min(88dvh,640px)] w-full max-w-full translate-x-[-50%] translate-y-0 overflow-y-auto rounded-t-2xl rounded-b-none border-[#E8E4F8] p-6 sm:max-w-md"
                  >
                    <DialogHeader>
                      <DialogTitle>Settings</DialogTitle>
                    </DialogHeader>
                    {clipSettingsRail}
                  </DialogContent>
                </Dialog>
              </>
            )}
          </div>
        </div>
      </section>

      <main className="flex-1">
        <HowItWorks />
        <PlatformsGrid />
        <section
          id="pricing"
          className="scroll-mt-24 border-t border-[#E8E4F8] py-16 dark:border-white/10"
        >
          <div className="mx-auto max-w-6xl px-4 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-[#0F0A1E] dark:text-white">
              Simple pricing
            </h2>
            <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-sm sm:text-base">
              Upgrade from the workspace toolbar or tap your credits pill. Stripe checkout is
              coming soon — join the waitlist inside Upgrade.
            </p>
            <Button
              type="button"
              className="mt-6 rounded-full bg-[#6C47FF] px-6 font-semibold text-white hover:bg-[#5835E8] genex-cta-glow"
              onClick={() => setBuyOpen(true)}
            >
              View plans
            </Button>
          </div>
        </section>

        <section className="mx-auto max-w-6xl space-y-4 border-t border-[#E8E4F8] px-4 py-16 dark:border-white/10">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold text-[#0F0A1E] dark:text-white">My Clips</h2>
            {user && totalClipCount > 5 ? (
              <span className="text-muted-foreground text-sm">View all — coming soon</span>
            ) : null}
          </div>
          {!user ? (
            <Card
              size="sm"
              className="border-[#E8E4F8] shadow-sm dark:border-white/10"
            >
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-sm">
                  Sign in to save and access your clip history across devices.
                </p>
                <Button
                  variant="link"
                  className="mt-2 h-auto px-0 text-[#6C47FF]"
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
                <Card
                  key={clip.id}
                  size="sm"
                  className="border-[#E8E4F8] shadow-sm transition duration-200 hover:scale-[1.02] hover:shadow-md dark:border-white/10"
                >
                  <CardHeader>
                    <CardTitle className="text-base">{clip.title}</CardTitle>
                    <CardDescription>
                      {new Date(clip.createdAt).toLocaleString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {isGenerationContextV1(clip.generationContext) ? (
                      <p className="mb-2 line-clamp-2 text-xs font-medium text-[#6C47FF]">
                        Refinement:{" "}
                        {Object.values(clip.generationContext.answers)
                          .filter(Boolean)
                          .slice(0, 2)
                          .join(" · ")}
                      </p>
                    ) : null}
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
      </main>

      <SiteFooter />

      <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
        <DialogContent className="border-[#E8E4F8] bg-white sm:max-w-md dark:border-white/10 dark:bg-zinc-950">
          <DialogHeader>
            <DialogTitle className="text-[#0F0A1E] dark:text-white">Sign in</DialogTitle>
            <DialogDescription>
              Sign in to save your clips and buy more credits.
            </DialogDescription>
          </DialogHeader>
          <form action={signInWithGoogle} className="space-y-3">
            <input type="hidden" name="next" value="/" />
            <Button
              type="submit"
              className="w-full rounded-xl bg-[#6C47FF] font-semibold text-white hover:bg-[#5835E8] genex-cta-glow"
            >
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
      <DialogContent className="max-h-[90vh] overflow-y-auto border-[#E8E4F8] bg-white sm:max-w-lg dark:border-white/10 dark:bg-zinc-950">
        <DialogHeader>
          <DialogTitle className="text-[#0F0A1E] dark:text-white">Upgrade & credits</DialogTitle>
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
            <Card key={p.name} size="sm" className="border-[#E8E4F8] shadow-sm dark:border-white/10">
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

        <div className="space-y-2 rounded-lg border border-dashed border-[#C4BAF0] bg-[#FAFAFC] p-4 dark:border-violet-500/25 dark:bg-zinc-900/40">
          <Label htmlFor="waitlist-email">Notify me at</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="waitlist-email"
              type="email"
              className="flex-1 rounded-md border border-[#E8E4F8] bg-white px-3 py-2 text-sm text-[#0F0A1E] outline-none ring-[#6C47FF]/25 focus-visible:ring-[3px] dark:border-white/10 dark:bg-zinc-950"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button
              type="button"
              className="rounded-full bg-[#6C47FF] font-semibold text-white hover:bg-[#5835E8] genex-cta-glow"
              disabled={busy}
              onClick={() => void submitWaitlist()}
            >
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
