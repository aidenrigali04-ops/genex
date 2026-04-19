"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock, User } from "lucide-react";

import { signInWithGoogle, signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
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
import { AdaClipWorkspace } from "@/components/genex/ada-clip-workspace";
import {
  AdaFigmaAmbientBackground,
  AdaFigmaClipHub,
  AdaFigmaMainHeader,
  AdaFigmaSidebarNav,
  type FigmaMainNavId,
} from "@/components/genex/ada-figma-dashboard";
import { SettingsRail } from "@/components/genex/settings-rail";
import {
  VideoVariationWorkspace,
  type VideoVariationWorkspaceHandle,
} from "@/components/video-variation-workspace";
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<"video" | "clip">("clip");
  const [inputMode, setInputMode] = useState<"text" | "url" | "file">("text");
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
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
  const startTsRef = useRef<number | null>(null);
  const videoWorkspaceRef = useRef<VideoVariationWorkspaceHandle | null>(null);

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

  const getElapsed = (ts?: number) => {
    if (!ts || startTsRef.current == null) return null;
    const s = Math.round((ts - startTsRef.current) / 1000);
    return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

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
    startTsRef.current = null;
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
            for (const st of r.steps) {
              if (startTsRef.current === null && typeof st.ts === "number") {
                startTsRef.current = st.ts;
                break;
              }
            }
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
              for (const st of r3.steps) {
                if (startTsRef.current === null && typeof st.ts === "number") {
                  startTsRef.current = st.ts;
                  break;
                }
              }
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
          for (const st of tail.steps) {
            if (startTsRef.current === null && typeof st.ts === "number") {
              startTsRef.current = st.ts;
              break;
            }
          }
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

  /** Match saved `generations` row to the output currently shown (list is newest-first). */
  const textRatingGenerationId = useMemo(() => {
    if (!streamedText.trim()) return undefined;
    const t = streamedText.trim();
    const row = clips.find((c) => c.output.trim() === t);
    return row?.id;
  }, [streamedText, clips]);

  const openClip = (clip: ClipPackageHistoryItem) => {
    setStreamedText(clip.output);
    const gc = clip.generationContext;
    setLastClipGenerationContext(isGenerationContextV1(gc) ? gc : null);
    setUploadFile(null);
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

  const sidebarRecentItems = myClipCards.slice(0, 12).map((clip) => ({
    id: clip.id,
    label: clip.title,
    onSelect: () => {
      openClip(clip);
      setMobileNavOpen(false);
      setWorkspaceTab("clip");
    },
  }));

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

  const accountMenu = user ? (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button
          id="account-menu-trigger"
          variant="ghost"
          size="sm"
          className="size-9 rounded-ada-pill border border-ada-border bg-ada-card font-semibold text-ada-primary hover:bg-ada-card-hover"
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
      className="gap-1.5 rounded-ada-pill border border-transparent text-ada-secondary hover:border-ada-border hover:bg-ada-card hover:text-ada-primary"
      onClick={() => setSignInOpen(true)}
    >
      <User className="size-4" />
      Sign in
    </Button>
  );

  const figmaCreditsPill = (
    <button
      type="button"
      onClick={() => setBuyOpen(true)}
      className={cn(
        "rounded-[32px] border border-white/48 bg-white/10 px-3 py-2 text-sm font-medium tracking-[0.14px] text-white transition-colors hover:bg-white/16 font-[family-name:var(--font-instrument-sans)]",
        !creditsUnlimited &&
          creditsRemaining <= 0 &&
          "border-red-400/80 text-red-200",
      )}
    >
      {creditsUnlimited ? "⚡ Unlimited" : `⚡ ${creditsRemaining} credits`}
    </button>
  );

  const showClipHub =
    workspaceTab === "clip" &&
    !loading &&
    !streamedText.trim() &&
    !refinementOpen &&
    inputMode === "text" &&
    !uploadFile &&
    !url.trim();

  const figmaActiveMain: FigmaMainNavId =
    workspaceTab === "video" ? "video" : "clip";

  const handleFigmaMainNav = useCallback((id: FigmaMainNavId) => {
    if (id === "video") {
      setWorkspaceTab("video");
      setMobileNavOpen(false);
      return;
    }
    if (id === "clip") {
      setWorkspaceTab("clip");
      setMobileNavOpen(false);
    }
  }, []);

  const figmaRecentSection =
    sidebarRecentItems.length === 0 ? (
      <p className="px-3 text-xs text-white/45">No recent clip packages yet.</p>
    ) : (
      <>
        <p className="px-3 pb-2 text-[10px] font-medium uppercase tracking-widest text-white/40">
          Recent
        </p>
        <div className="flex flex-col gap-1">
          {sidebarRecentItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                item.onSelect();
                setMobileNavOpen(false);
              }}
              className="truncate rounded-lg px-3 py-2 text-left text-sm text-white/80 transition-colors hover:bg-white/10"
            >
              {item.label}
            </button>
          ))}
        </div>
      </>
    );

  const recentDropdown = (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-2 rounded-[32px] border border-white/48 px-3 py-2 text-sm font-medium tracking-[0.14px] text-white transition-colors hover:bg-white/10 font-[family-name:var(--font-instrument-sans)]"
      >
        <Clock className="size-4 shrink-0 text-white" aria-hidden />
        Recent
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 min-w-56 overflow-y-auto border border-ada-border bg-ada-card text-ada-primary"
      >
        {sidebarRecentItems.length === 0 ? (
          <div className="px-3 py-2 text-sm text-ada-secondary">No recent items yet.</div>
        ) : (
          sidebarRecentItems.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onClick={() => {
                item.onSelect();
              }}
            >
              {item.label}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const handleFigmaAccount = useCallback(() => {
    if (!user) {
      setSignInOpen(true);
      return;
    }
    document.getElementById("account-menu-trigger")?.click();
  }, [user]);

  const onVideoJobFinished = useCallback(() => {
    void router.refresh();
  }, [router]);

  const openWorkspaceSettings = useCallback(() => {
    if (workspaceTab === "clip") {
      setClipSettingsOpen(true);
      return;
    }
    videoWorkspaceRef.current?.openSettings();
  }, [workspaceTab]);

  const hubTitle =
    workspaceTab === "video" ? "Video" : showClipHub ? "New Search" : "Clip package";

  return (
    <>
      <div className="relative flex h-screen overflow-hidden bg-[#0A050F]">
        <AdaFigmaAmbientBackground />

        <aside className="relative z-[1] hidden shrink-0 lg:block">
          <AdaFigmaSidebarNav
            activeMain={figmaActiveMain}
            onSelectMain={handleFigmaMainNav}
            onUpgrade={() => setBuyOpen(true)}
            onSettings={openWorkspaceSettings}
            onAccount={handleFigmaAccount}
            recentSection={figmaRecentSection}
          />
        </aside>

        <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <DialogContent
            showCloseButton
            className="fixed top-0 left-0 z-50 h-full max-h-none w-[min(100%,280px)] max-w-[280px] translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 border-r border-white p-0 sm:max-w-[280px]"
          >
            <AdaFigmaSidebarNav
              activeMain={figmaActiveMain}
              onSelectMain={(id) => {
                handleFigmaMainNav(id);
                setMobileNavOpen(false);
              }}
              onUpgrade={() => {
                setBuyOpen(true);
                setMobileNavOpen(false);
              }}
              onSettings={() => {
                openWorkspaceSettings();
                setMobileNavOpen(false);
              }}
              onAccount={() => {
                handleFigmaAccount();
                setMobileNavOpen(false);
              }}
              recentSection={figmaRecentSection}
            />
          </DialogContent>
        </Dialog>

        <main className="relative z-[1] flex min-w-0 flex-1 flex-col overflow-hidden">
          {workspaceTab !== "video" ? (
            <AdaFigmaMainHeader
              menuButton={
                <button
                  type="button"
                  className="shrink-0 text-white/80 hover:text-white lg:hidden"
                  aria-label="Open menu"
                  onClick={() => setMobileNavOpen(true)}
                >
                  ☰
                </button>
              }
              title={hubTitle}
              recentTrigger={recentDropdown}
              trailing={
                <div className="flex items-center gap-2">
                  {user ? (
                    <span className="hidden text-[10px] text-white/50 md:inline">
                      {totalClipCount} saved
                    </span>
                  ) : null}
                  {figmaCreditsPill}
                  {accountMenu}
                </div>
              }
            />
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {workspaceTab === "video" ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <VideoVariationWorkspace
                  ref={videoWorkspaceRef}
                  hideMarketingTitle
                  user={user}
                  creditsRemaining={creditsRemaining}
                  creditsUnlimited={creditsUnlimited}
                  setCreditsRemaining={setCreditsRemaining}
                  onOpenBuy={() => setBuyOpen(true)}
                  onOpenSignIn={() => setSignInOpen(true)}
                  onJobFinished={onVideoJobFinished}
                  onOpenMobileNav={() => setMobileNavOpen(true)}
                />
              </div>
            ) : showClipHub ? (
              <AdaFigmaClipHub
                text={text}
                onTextChange={(v) => {
                  setText(v);
                  setInputMode("text");
                }}
                canSubmit={canSubmit}
                onSubmit={() => setRefinementOpen(true)}
                onPickSuggestion={(prompt) => {
                  setText(prompt);
                  setInputMode("text");
                  setUrl("");
                  setUploadFile(null);
                }}
                onFileSelected={(file) => {
                  setUploadFile(file);
                  setInputMode("file");
                  setText("");
                  setUrl("");
                }}
              />
            ) : (
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-transparent">
                <AdaClipWorkspace
                  inputMode={inputMode}
                  onInputModeChange={(mode) => {
                    setInputMode(mode);
                    if (mode !== "file") setUploadFile(null);
                  }}
                  text={text}
                  onTextChange={setText}
                  url={url}
                  onUrlChange={setUrl}
                  uploadFile={uploadFile}
                  onFileChange={setUploadFile}
                  selectedModel={selectedModel}
                  onModelChange={setSelectedModel}
                  preset={preset}
                  onPresetChange={setPreset}
                  loading={loading}
                  canSubmit={canSubmit}
                  onSubmit={() => setRefinementOpen(true)}
                  maxUploadMb={Math.round(MAX_MEDIA_UPLOAD_BYTES / (1024 * 1024))}
                  generationSteps={generationSteps}
                  getElapsed={getElapsed}
                  error={error}
                  fetchingYoutubeTranscript={fetchingYoutubeTranscript}
                  progress={progress}
                  streamedText={streamedText}
                  parsedClipPackage={parsedClipPackage}
                  clipFormatTags={clipFormatTags}
                  verticalPreviewText={verticalPreviewText}
                  copiedId={copiedId}
                  onCopy={copyText}
                  onRegenerate={() => setRefinementOpen(true)}
                  textRatingGenerationId={textRatingGenerationId}
                  lastClipGenerationContext={lastClipGenerationContext}
                  clipOriginalPromptSummary={clipOriginalPromptSummary}
                  variant="adaKit"
                  onTextVideoCreditsRemainingChange={(n) => {
                    if (!creditsUnlimited) setCreditsRemaining(n);
                  }}
                  refinementOpen={refinementOpen}
                  refinementPlatformIds={CLIP_PLATFORMS}
                  refinementInputSummary={
                    inputMode === "text"
                      ? text.trim().slice(0, 120) || "Text / idea"
                      : inputMode === "url"
                        ? url.trim() || "URL"
                        : uploadFile
                          ? `File: ${uploadFile.name}`
                          : "Upload"
                  }
                  onRefinementConfirm={(ctx) => {
                    const ctxWithModel: GenerationContextV1 = {
                      ...ctx,
                      answers: {
                        ...ctx.answers,
                        preferredModel: selectedModel,
                      },
                    };
                    pendingGenerationContextRef.current = ctxWithModel;
                    setLastClipGenerationContext(ctxWithModel);
                    setRefinementOpen(false);
                    void runGeneration();
                  }}
                  onRefinementCancel={() => setRefinementOpen(false)}
                />
              </div>
            )}
          </div>
        </main>
      </div>

      {workspaceTab === "clip" ? (
        <>
          <Dialog open={clipSettingsOpen} onOpenChange={setClipSettingsOpen}>
            <DialogContent
              showCloseButton
              className="fixed top-auto right-auto bottom-0 left-1/2 max-h-[min(88dvh,640px)] w-full max-w-full translate-x-[-50%] translate-y-0 overflow-y-auto rounded-t-2xl rounded-b-none border border-ada-border bg-ada-card p-6 text-ada-primary sm:max-w-md"
            >
              <DialogHeader>
                <DialogTitle>Settings</DialogTitle>
              </DialogHeader>
              {clipSettingsRail}
            </DialogContent>
          </Dialog>
        </>
      ) : null}

      <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
        <DialogContent className="border border-ada-border bg-ada-card text-ada-primary sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sign in</DialogTitle>
            <DialogDescription>
              Sign in to save your clips and buy more credits.
            </DialogDescription>
          </DialogHeader>
          <form action={signInWithGoogle} className="space-y-3">
            <input type="hidden" name="next" value="/" />
            <Button
              type="submit"
              className="w-full rounded-ada-input bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF] font-semibold text-white transition-opacity hover:opacity-90"
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
    </>
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
      <DialogContent className="max-h-[90vh] overflow-y-auto border border-ada-border bg-ada-card text-ada-primary sm:max-w-lg">
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
            <Card
              key={p.name}
              size="sm"
              className="border border-ada-border bg-ada-elevated transition-colors hover:border-ada-border-active"
            >
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

        <div className="space-y-2 rounded-lg border border-dashed border-ada-border-active bg-ada-app/80 p-4">
          <Label htmlFor="waitlist-email">Notify me at</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="waitlist-email"
              type="email"
              className="flex-1 rounded-ada-input border border-ada-border bg-ada-input px-3 py-2 text-sm text-ada-primary outline-none transition-colors placeholder:text-ada-disabled focus:border-ada-focus"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button
              type="button"
              className="rounded-ada-input bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF] font-semibold text-white transition-opacity hover:opacity-90"
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
