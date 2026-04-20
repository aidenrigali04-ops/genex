"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Clock, User } from "lucide-react";

import { signInWithGoogle, signOut } from "@/app/auth/actions";
import { GuestSignupGateDialog } from "@/components/auth/guest-signup-gate-dialog";
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
import { deriveClipTitle, parseClipPackageSections } from "@/lib/clip-package";
import {
  buildUserMessageSummary,
  type ClipTurn,
  type LiveClipTurnSnapshot,
} from "@/lib/clip-turn";
import { MAX_CLIP_SOURCE_CHARS } from "@/lib/clip-model-input";
import {
  FREE_DAILY_CREDITS,
  isUnlimitedCreditsModeClient,
  UNLIMITED_CREDITS_SENTINEL,
} from "@/lib/credits-config";
import { type GenerationPresetId } from "@/lib/generation-presets";
import { decrementGuestCredit, readGuestCreditsRemaining } from "@/lib/guest-credits";
import { extractPlatformSection } from "@/lib/parse-generation-output";
import {
  createGenerationStreamParser,
  type GenerationUiStep,
} from "@/lib/generation-stream-protocol";
import { MAX_MEDIA_UPLOAD_BYTES } from "@/lib/media-upload-limits";
import { isYoutubeVideoUrlForTranscript } from "@/lib/youtube-url";
import { type PlatformId } from "@/lib/platforms";
import type { AdaSidebarVoiceProfile } from "@/components/genex/ada-sidebar";
import { AdaSidebar } from "@/components/genex/ada-sidebar";
import { AdaClipWorkspace } from "@/components/genex/ada-clip-workspace";
import type { VoiceProfileData } from "@/components/genex/ada-voice-profile-modal";
import {
  AdaFigmaAmbientBackground,
  AdaFigmaClipHub,
  AdaFigmaMainHeader,
  AdaFigmaSidebarNav,
  type FigmaMainNavId,
} from "@/components/genex/ada-figma-dashboard";
import { SettingsRail } from "@/components/genex/settings-rail";
import {
  AdaUpgradeModal,
  type UpgradeTrigger,
} from "@/components/genex/ada-upgrade-modal";
import { AdaVideoWorkspace } from "@/components/genex/ada-video-workspace";
import type { GenerationContextV1 } from "@/lib/generation-context";
import { isGenerationContextV1 } from "@/lib/generation-context";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

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
  /** Server profile `current_streak` for sidebar. */
  initialCurrentStreak?: number;
  /** Server voice profile fields for sidebar + modal. */
  initialVoiceProfile?: AdaSidebarVoiceProfile | null;
  /** Server GENEX_UNLIMITED_CREDITS — skips RPC; use with NEXT_PUBLIC for guests. */
  unlimitedCredits?: boolean;
  authError?: string | null;
  authSuccess?: string | null;
};

export function HomeWorkspace({
  initialUser,
  initialCreditsRemaining,
  initialClipPackages,
  totalClipCount,
  initialCurrentStreak = 0,
  initialVoiceProfile = null,
  unlimitedCredits = false,
  authError,
  authSuccess,
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
  const [guestSignupGateOpen, setGuestSignupGateOpen] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeTrigger, setUpgradeTrigger] =
    useState<UpgradeTrigger>("manual");
  const [clipSettingsOpen, setClipSettingsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<"video" | "clip">("video");
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
  const [turns, setTurns] = useState<ClipTurn[]>([]);
  const [liveTurnSnapshot, setLiveTurnSnapshot] =
    useState<LiveClipTurnSnapshot | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const pendingGenerationContextRef = useRef<GenerationContextV1 | null>(null);
  const startTsRef = useRef<number | null>(null);

  const [refinementOpen, setRefinementOpen] = useState(false);
  const [lastClipGenerationContext, setLastClipGenerationContext] =
    useState<GenerationContextV1 | null>(null);
  const [currentStreak, setCurrentStreak] = useState(initialCurrentStreak);
  const [showFirstGenCelebration, setShowFirstGenCelebration] =
    useState(false);
  const [voiceProfileOpen, setVoiceProfileOpen] = useState(false);
  const [voiceProfile, setVoiceProfile] = useState<AdaSidebarVoiceProfile | null>(
    initialVoiceProfile,
  );
  const supabase = useMemo(() => createClient(), []);

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
    setCurrentStreak(initialCurrentStreak);
    setVoiceProfile(initialVoiceProfile);
  }, [
    initialUser,
    initialCreditsRemaining,
    initialClipPackages,
    initialCurrentStreak,
    initialVoiceProfile,
    unlimitedCredits,
  ]);

  useEffect(() => {
    if (user) setSignInOpen(false);
  }, [user]);

  useEffect(() => {
    if (user) setGuestSignupGateOpen(false);
  }, [user]);

  useEffect(() => {
    const s = authSuccess?.trim();
    if (!s) return;
    toast.success(s);
    router.replace("/", { scroll: false });
  }, [authSuccess, router]);

  const handleSaveVoiceProfile = useCallback(
    async (data: VoiceProfileData) => {
      if (!user) throw new Error("Sign in required.");
      const { error } = await supabase
        .from("profiles")
        .update({
          niche: data.niche,
          tone_preference: data.tone_preference,
          hook_style: data.hook_style,
        })
        .eq("id", user.id);
      if (error) throw error;
      setVoiceProfile((prev) =>
        prev
          ? { ...prev, ...data }
          : {
              niche: data.niche,
              tone_preference: data.tone_preference,
              hook_style: data.hook_style,
            },
      );
    },
    [user, supabase],
  );

  useEffect(() => {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.generationId) return prev;
      const row = clips.find((c) => c.output.trim() === last.rawText.trim());
      if (!row) return prev;
      return prev.map((t, i) =>
        i === prev.length - 1 ? { ...t, generationId: row.id } : t,
      );
    });
  }, [clips]);

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
        setGuestSignupGateOpen(true);
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
    setLiveTurnSnapshot({
      userMessage: buildUserMessageSummary(text, url, uploadFile, inputMode),
      inputMode,
      preset,
    });

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
          if (!user) setGuestSignupGateOpen(true);
          else setBuyOpen(true);
        }
        setError(message || "Request failed");
        setProgress(0);
        setLoading(false);
        return;
      }

      const firstGenHeader = res.headers.get("x-genex-is-first-gen");
      const streakHeader = res.headers.get("x-genex-streak");
      if (firstGenHeader === "1") {
        setShowFirstGenCelebration(true);
      }
      if (streakHeader != null && streakHeader !== "") {
        const n = Number.parseInt(streakHeader, 10);
        if (!Number.isNaN(n)) {
          setCurrentStreak(n);
        }
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
            if (code === "no_credits") {
              if (!user) setGuestSignupGateOpen(true);
              else setBuyOpen(true);
            }
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
            if (code === "no_credits") {
              if (!user) setGuestSignupGateOpen(true);
              else setBuyOpen(true);
            }
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
      } else if (!streamFatal && accumulated.trim()) {
        const extracted = extractPlatformSection(
          accumulated,
          "clip_package",
          CLIP_PLATFORMS,
        ).trim();
        const rawBody =
          extracted ||
          (/TOP CLIP MOMENTS/i.test(accumulated) ? accumulated.trim() : "");
        const pkg = parseClipPackageSections(
          rawBody.length > 0 ? rawBody : accumulated,
        );
        setTurns((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            userMessage: buildUserMessageSummary(
              text,
              url,
              uploadFile,
              inputMode,
            ),
            inputMode,
            preset,
            timestamp: new Date(),
            parsedClipPackage: pkg,
            rawText: accumulated,
            generationId: null,
            generationContext: lastClipGenerationContext,
          },
        ]);
        setText("");
        setUrl("");
        setUploadFile(null);
        setStreamedText("");
        setGenerationSteps([]);
      }

      router.refresh();
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setError("Cancelled.");
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    } finally {
      setLiveTurnSnapshot(null);
      setFetchingYoutubeTranscript(false);
      setLoading(false);
      setTimeout(() => setProgress(0), 400);
    }
  }, [
    creditsUnlimited,
    inputMode,
    lastClipGenerationContext,
    preset,
    router,
    text,
    url,
    uploadFile,
    user,
  ]);

  const handleStopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const copyText = async (id: string, body: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(body);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError("Could not copy.");
      throw new Error("clipboard_write_failed");
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
    const extracted = extractPlatformSection(
      clip.output,
      "clip_package",
      CLIP_PLATFORMS,
    ).trim();
    const rawBody =
      extracted ||
      (/TOP CLIP MOMENTS/i.test(clip.output) ? clip.output.trim() : "");
    const pkg = parseClipPackageSections(
      rawBody.length > 0 ? rawBody : clip.output,
    );

    let mode: "text" | "url" | "file" = "text";
    let userMessage = "Saved clip";
    if (clip.inputUrl?.startsWith("file:")) {
      mode = "text";
      userMessage = buildUserMessageSummary(
        clip.inputText ?? "",
        "",
        null,
        "text",
      );
    } else if (clip.inputUrl) {
      mode = "url";
      userMessage = buildUserMessageSummary("", clip.inputUrl, null, "url");
    } else {
      userMessage = buildUserMessageSummary(
        clip.inputText ?? "",
        "",
        null,
        "text",
      );
    }

    setTurns([
      {
        id: crypto.randomUUID(),
        userMessage,
        inputMode: mode,
        preset: null,
        timestamp: new Date(clip.createdAt),
        parsedClipPackage: pkg,
        rawText: clip.output,
        generationId: clip.id,
        generationContext: isGenerationContextV1(clip.generationContext)
          ? clip.generationContext
          : null,
      },
    ]);
    setStreamedText("");
    setGenerationSteps([]);
    setLiveTurnSnapshot(null);

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
    turns.length === 0 &&
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
        className="inline-flex items-center gap-2 rounded-[32px] border border-white/48 py-2 pl-3 pr-4 text-sm font-medium tracking-[0.14px] text-white transition-colors hover:bg-white/10 font-[family-name:var(--font-instrument-sans)]"
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
    // Defer so we never refresh during the same React commit as poll/state updates
    // (avoids intermittent "page couldn't load" / RSC failures after video completes).
    queueMicrotask(() => {
      void router.refresh();
    });
  }, [router]);

  const openUpgrade = useCallback((trigger: UpgradeTrigger) => {
    setUpgradeTrigger(trigger);
    setUpgradeModalOpen(true);
  }, []);

  const openWorkspaceSettings = useCallback(() => {
    if (workspaceTab === "clip") {
      setClipSettingsOpen(true);
      return;
    }
    setBuyOpen(true);
  }, [workspaceTab]);

  const hubTitle =
    workspaceTab === "video"
      ? "Clip a Video"
      : showClipHub
        ? "New Search"
        : "Clip package";

  return (
    <>
      <div className="relative flex h-screen overflow-hidden bg-[#0A050F]">
        {workspaceTab !== "video" ? <AdaFigmaAmbientBackground /> : null}

        {workspaceTab !== "video" ? (
        <aside className="relative z-[1] hidden shrink-0 lg:block">
          <AdaFigmaSidebarNav
            activeMain={figmaActiveMain}
            onSelectMain={handleFigmaMainNav}
            onUpgrade={() => openUpgrade("manual")}
            onSettings={openWorkspaceSettings}
            onAccount={handleFigmaAccount}
            recentSection={figmaRecentSection}
            generationStreak={currentStreak}
            voiceProfile={user ? voiceProfile : null}
            onEditVoiceProfile={
              user ? () => setVoiceProfileOpen(true) : undefined
            }
          />
        </aside>
        ) : null}

        {workspaceTab !== "video" ? (
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
                openUpgrade("manual");
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
              generationStreak={currentStreak}
              voiceProfile={user ? voiceProfile : null}
              onEditVoiceProfile={
                user ? () => setVoiceProfileOpen(true) : undefined
              }
            />
          </DialogContent>
        </Dialog>
        ) : null}

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
            recentTrigger={workspaceTab === "clip" ? recentDropdown : undefined}
            trailing={
              <div className="flex items-center gap-2">
                {workspaceTab === "clip" && user ? (
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
                <AdaVideoWorkspace
                  userId={user?.id ?? null}
                  authUser={user}
                  creditsRemaining={creditsRemaining}
                  creditsUnlimited={creditsUnlimited}
                  onCreditChange={(n) => {
                    if (!creditsUnlimited) setCreditsRemaining(n);
                  }}
                  onJobFinished={onVideoJobFinished}
                  onUpgrade={() => setBuyOpen(true)}
                  onOpenSignIn={() => setSignInOpen(true)}
                  onWorkspaceSettings={openWorkspaceSettings}
                  onWorkspaceAccount={handleFigmaAccount}
                  headerTrailing={
                    <div className="flex items-center gap-2">
                      {figmaCreditsPill}
                      {accountMenu}
                    </div>
                  }
                  variant="adaKit"
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
                  turns={turns}
                  liveTurnSnapshot={liveTurnSnapshot}
                  authUserId={user?.id}
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
                  onStop={handleStopGeneration}
                  maxUploadMb={Math.round(MAX_MEDIA_UPLOAD_BYTES / (1024 * 1024))}
                  generationSteps={generationSteps}
                  getElapsed={getElapsed}
                  error={error}
                  fetchingYoutubeTranscript={fetchingYoutubeTranscript}
                  progress={progress}
                  streamedText={streamedText}
                  copiedId={copiedId}
                  onCopy={copyText}
                  onRegenerate={() => setRefinementOpen(true)}
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
                  emptyStateIsAuthenticated={!!user}
                  emptyStateHasGenerated={clips.length > 0 || totalClipCount > 0}
                  onRemix={(prompt) => {
                    const t = prompt.trim();
                    if (/^https?:\/\//i.test(t)) {
                      setInputMode("url");
                      setUrl(t);
                      setText("");
                    } else {
                      setInputMode("text");
                      setText(t);
                      setUrl("");
                    }
                    setUploadFile(null);
                  }}
                  onExamplePrompt={(prompt, mode) => {
                    if (mode === "url") {
                      setInputMode("url");
                      setUrl(prompt);
                      setText("");
                    } else {
                      setInputMode("text");
                      setText(prompt);
                      setUrl("");
                    }
                    setUploadFile(null);
                    window.setTimeout(() => setRefinementOpen(true), 400);
                  }}
                  onPreferIdeaFirst={() => {
                    setInputMode("text");
                    setUrl("");
                    setUploadFile(null);
                  }}
                  showFirstGenCelebration={showFirstGenCelebration}
                  voiceProfile={user ? voiceProfile : null}
                  voiceProfileOpen={voiceProfileOpen}
                  onVoiceProfileOpenChange={setVoiceProfileOpen}
                  onSaveVoiceProfile={
                    user ? handleSaveVoiceProfile : undefined
                  }
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
              {user ? (
                <div className="mt-4 max-h-[42dvh] overflow-y-auto">
                  <AdaSidebar
                    footerOnly
                    user={user}
                    creditsRemaining={creditsRemaining}
                    creditsUnlimited={creditsUnlimited}
                    workspaceTab={workspaceTab}
                    onWorkspaceTab={(t) => {
                      setWorkspaceTab(t);
                      setClipSettingsOpen(false);
                    }}
                    onUpgrade={() => {
                      openUpgrade("manual");
                      setClipSettingsOpen(false);
                    }}
                    onSignIn={() => setSignInOpen(true)}
                    onSignOut={signOut}
                    recentItems={sidebarRecentItems}
                    voiceProfile={voiceProfile}
                    onEditVoiceProfile={() => {
                      setVoiceProfileOpen(true);
                      setClipSettingsOpen(false);
                    }}
                    generationStreak={currentStreak}
                  />
                </div>
              ) : null}
            </DialogContent>
          </Dialog>
        </>
      ) : null}

      <GuestSignupGateDialog
        open={guestSignupGateOpen}
        onOpenChange={setGuestSignupGateOpen}
        nextPath="/"
        onOpenWaitlist={() => setBuyOpen(true)}
      />

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

      <AdaUpgradeModal
        open={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
        creditsRemaining={creditsRemaining}
        creditsUnlimited={creditsUnlimited}
        trigger={upgradeTrigger}
        variant="adaKit"
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
