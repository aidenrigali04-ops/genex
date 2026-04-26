"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Clock, User } from "lucide-react";

import { signOut } from "@/app/auth/actions";
import { GuestSignupGateOverlay } from "@/components/auth/guest-signup-gate-overlay";
import { AdaLoginPanel } from "@/components/auth/ada-login-panel";
import { AdaMarketingPanel } from "@/components/auth/ada-sign-up-view";
import { Button } from "@/components/ui/button";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  deriveClipTitle,
  parseClipPackageSections,
  type ClipSectionMap,
} from "@/lib/clip-package";
import {
  buildUserMessageSummary,
  type ClipTurn,
  type LiveClipTurnSnapshot,
} from "@/lib/clip-turn";
import type { RemoteRefinementState } from "@/components/refinement-chat-panel";
import { MAX_CLIP_SOURCE_CHARS } from "@/lib/clip-model-input";
import type { RefinementStepDef } from "@/lib/refinement-steps";
import {
  GUEST_LIFETIME_FREE_CREDITS,
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
import {
  AdaSidebar,
  recentDateGroup,
  type AdaSidebarRecentItem,
} from "@/components/genex/ada-sidebar";
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
import {
  isGenerationContextV1,
  sanitizeGenerationContextForTransport,
} from "@/lib/generation-context";
import type { ProjectSession } from "@/lib/projects";
import { trackAha } from "@/lib/analytics";
import { autoTitle, cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const CLIP_PLATFORMS: PlatformId[] = ["clip_package"];
const GENERATE_TRIGGER_RE =
  /\b(generate|run it|start (?:job|generation)|go ahead|create it|make it)\b/i;

function projectSessionToClipPackageItem(
  s: ProjectSession,
): ClipPackageHistoryItem {
  return {
    id: s.id,
    createdAt: s.createdAt,
    inputText: s.inputText,
    inputUrl: s.inputUrl,
    output: s.outputText ?? "",
    platforms: CLIP_PLATFORMS,
    generationKind: s.generationKind,
    generationContext: null,
  };
}

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
  /** `generic` = plain chat-style generation; default clip package flow when omitted. */
  generationKind?: "clip_package" | "generic";
};

type HomeWorkspaceProps = {
  initialUser: { id: string; email: string } | null;
  initialCreditsRemaining: number | null;
  /** Max credits for meter (monthly allowance or guest lifetime cap). */
  creditMeterMax?: number;
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
  /** Post-login redirect for forms opened from the home sign-in overlay. */
  signInNext?: string;
};

export function HomeWorkspace({
  initialUser,
  initialCreditsRemaining,
  creditMeterMax: initialCreditMeterMax = GUEST_LIFETIME_FREE_CREDITS,
  initialClipPackages,
  totalClipCount,
  initialCurrentStreak = 0,
  initialVoiceProfile = null,
  unlimitedCredits = false,
  authError,
  authSuccess,
  signInNext = "/",
}: HomeWorkspaceProps) {
  const router = useRouter();
  const creditsUnlimited =
    unlimitedCredits || isUnlimitedCreditsModeClient();
  const [user, setUser] = useState(initialUser);
  const [creditMeterMax, setCreditMeterMax] = useState(initialCreditMeterMax);
  const [creditsRemaining, setCreditsRemaining] = useState<number>(() => {
    if (creditsUnlimited) return UNLIMITED_CREDITS_SENTINEL;
    if (initialCreditsRemaining != null) return initialCreditsRemaining;
    return GUEST_LIFETIME_FREE_CREDITS;
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
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [clips, setClips] = useState(initialClipPackages);
  const [turns, setTurns] = useState<ClipTurn[]>([]);
  const [liveTurnSnapshot, setLiveTurnSnapshot] =
    useState<LiveClipTurnSnapshot | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const pendingGenerationContextRef = useRef<GenerationContextV1 | null>(null);
  const startTsRef = useRef<number | null>(null);
  const youtubeTranscriptCacheRef = useRef<{
    url: string;
    transcript: string;
  } | null>(null);
  const refinementFetchAbortRef = useRef<AbortController | null>(null);
  const pendingInputSummaryRef = useRef<string>("");
  const pendingInputContentRef = useRef<{
    inputMode: "text" | "url" | "file";
    text: string;
    url: string;
    uploadFile: File | null;
  }>({
    inputMode: "text",
    text: "",
    url: "",
    uploadFile: null,
  });

  const [refinementOpen, setRefinementOpen] = useState(false);
  const [clipRefinementRemote, setClipRefinementRemote] = useState<
    RemoteRefinementState | undefined
  >(undefined);
  const [refinementPlanInference, setRefinementPlanInference] = useState<{
    inferredClipPurpose?: string;
    inferredPurposeRationale?: string;
  } | null>(null);
  const [refinementRetry, setRefinementRetry] = useState(0);
  const [lastClipGenerationContext, setLastClipGenerationContext] =
    useState<GenerationContextV1 | null>(null);
  const [currentStreak, setCurrentStreak] = useState(initialCurrentStreak);
  const [showFirstGenCelebration, setShowFirstGenCelebration] =
    useState(false);
  const [voiceProfileOpen, setVoiceProfileOpen] = useState(false);
  const [voiceProfile, setVoiceProfile] = useState<AdaSidebarVoiceProfile | null>(
    initialVoiceProfile,
  );
  const [recentProjectSessions, setRecentProjectSessions] = useState<
    ProjectSession[]
  >([]);
  const [generationSidebarRecents, setGenerationSidebarRecents] = useState<
    AdaSidebarRecentItem[]
  >([]);
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
    setCreditMeterMax(initialCreditMeterMax);
    setClips(initialClipPackages);
    setCurrentStreak(initialCurrentStreak);
    setVoiceProfile(initialVoiceProfile);
  }, [
    initialUser,
    initialCreditsRemaining,
    initialCreditMeterMax,
    initialClipPackages,
    initialCurrentStreak,
    initialVoiceProfile,
    unlimitedCredits,
  ]);

  useEffect(() => {
    if (user) setSignInOpen(false);
  }, [user]);

  useEffect(() => {
    if (authError && !user) setSignInOpen(true);
  }, [authError, user]);

  useEffect(() => {
    if (user) setGuestSignupGateOpen(false);
  }, [user]);

  const fetchRecentProjectSessions = useCallback(async () => {
    if (!user?.id) {
      setRecentProjectSessions([]);
      return;
    }
    const res = await fetch("/api/generations", { credentials: "same-origin" });
    const json = (await res.json()) as {
      data: ProjectSession[] | null;
      error: string | null;
    };
    if (!res.ok || !json.data) return;
    setRecentProjectSessions(json.data);
  }, [user?.id]);

  useEffect(() => {
    void fetchRecentProjectSessions();
  }, [fetchRecentProjectSessions]);

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

  const [refinementSessionPlanKey, setRefinementSessionPlanKey] =
    useState("");
  const [refinementPersistenceSessionId, setRefinementPersistenceSessionId] =
    useState("");
  const refinementAutoStartedRef = useRef(false);

  function looksTextualUpload(file: File): boolean {
    if (file.type.startsWith("text/")) return true;
    return /\.(txt|md|csv|json|log|tsx?|jsx?)$/i.test(file.name);
  }

  const runClipRefinementFetch = useCallback(
    async (signal: AbortSignal): Promise<{
      steps: RefinementStepDef[];
      planSource: "llm";
      detectedPurpose?: string;
      purposeRationale?: string;
    }> => {
      const p = pendingInputContentRef.current;
      let excerpt = "";
      if (p.inputMode === "text") {
        excerpt = p.text.slice(0, MAX_CLIP_SOURCE_CHARS);
      } else if (p.inputMode === "url") {
        const u = p.url.trim();
        if (isYoutubeVideoUrlForTranscript(u)) {
          const trRes = await fetch("/api/youtube-transcript", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify({ url: u }),
          });
          if (trRes.ok) {
            const data = (await trRes.json()) as { transcript?: string };
            const raw =
              typeof data.transcript === "string" ? data.transcript.trim() : "";
            if (raw) {
              youtubeTranscriptCacheRef.current = { url: u, transcript: raw };
              excerpt = raw.slice(0, MAX_CLIP_SOURCE_CHARS);
            }
          }
        } else {
          const pvRes = await fetch("/api/refinement-source-preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify({ url: u }),
          });
          if (pvRes.ok) {
            const pv = (await pvRes.json()) as { excerpt?: string };
            excerpt = (pv.excerpt ?? "").trim().slice(0, MAX_CLIP_SOURCE_CHARS);
          }
        }
      } else if (p.inputMode === "file" && p.uploadFile) {
        if (looksTextualUpload(p.uploadFile)) {
          try {
            const blob = p.uploadFile.slice(0, MAX_CLIP_SOURCE_CHARS);
            excerpt = (await blob.text()).trim().slice(0, MAX_CLIP_SOURCE_CHARS);
          } catch {
            excerpt = "";
          }
        }
      }

      let inputContent = "";
      let refineInputMode: "url" | "text" = "text";
      if (p.inputMode === "text") {
        inputContent = p.text.slice(0, 4000);
        refineInputMode = "text";
      } else if (p.inputMode === "url") {
        refineInputMode = "url";
        const u = p.url.trim();
        inputContent = (excerpt.trim() || u).slice(0, 4000);
      } else if (p.uploadFile) {
        refineInputMode = "text";
        inputContent = (
          excerpt.trim() ||
          `File: ${p.uploadFile.name} (${p.uploadFile.type || "unknown type"}), ${p.uploadFile.size} bytes`
        ).slice(0, 4000);
      }

      const voicePayload =
        user && voiceProfile
          ? {
              niche: voiceProfile.niche,
              tone_preference: voiceProfile.tone_preference,
              hook_style: voiceProfile.hook_style,
            }
          : null;

      const planRes = await fetch("/api/refine-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          inputContent,
          inputMode: refineInputMode,
          platformIds: CLIP_PLATFORMS,
          voiceProfile: voicePayload,
        }),
      });

      let rawJson: unknown = null;
      try {
        rawJson = await planRes.json();
      } catch {
        rawJson = null;
      }
      const payload = rawJson as {
        data: {
          steps: RefinementStepDef[];
          detectedPurpose?: string;
          purposeRationale?: string;
        } | null;
        error?: string | null;
      } | null;

      const err =
        typeof payload?.error === "string" && payload.error.trim()
          ? payload.error.trim()
          : !planRes.ok
            ? planRes.statusText
            : null;
      if (err) {
        throw new Error(err);
      }
      if (!payload?.data?.steps?.length) {
        throw new Error("No refinement steps returned");
      }

      return {
        steps: payload.data.steps,
        planSource: "llm",
        detectedPurpose:
          typeof payload.data.detectedPurpose === "string"
            ? payload.data.detectedPurpose
            : undefined,
        purposeRationale:
          typeof payload.data.purposeRationale === "string"
            ? payload.data.purposeRationale
            : undefined,
      };
    },
    [user, voiceProfile],
  );

  const beginClipRefinement = useCallback(() => {
    // Capture summary before clearing state
    const summary =
      inputMode === "text"
        ? text.trim().slice(0, 120) || "Text / idea"
        : inputMode === "url"
          ? url.trim() || "URL"
          : uploadFile
            ? `File: ${uploadFile.name}`
            : "Upload";
    pendingInputSummaryRef.current = summary;

    pendingInputContentRef.current = {
      inputMode,
      text: text.trim(),
      url: url.trim(),
      uploadFile: uploadFile ?? null,
    };

    const snap = pendingInputContentRef.current;
    const head = snap.text.slice(0, 160);
    const tail = snap.text.length > 320 ? snap.text.slice(-160) : "";
    setRefinementSessionPlanKey(
      `${snap.inputMode}:${snap.text.length}:${head}:${tail}:${snap.url.trim()}:${snap.uploadFile?.name ?? ""}:${snap.uploadFile?.size ?? 0}:${snap.uploadFile?.lastModified ?? 0}`,
    );
    setRefinementPersistenceSessionId(crypto.randomUUID());

    setRefinementRetry(0);
    refinementAutoStartedRef.current = false;
    setClipRefinementRemote({ phase: "loading" });
    setRefinementPlanInference(null);
    setRefinementOpen(true);
    setText("");
    setUrl("");
    setUploadFile(null);
  }, [inputMode, text, url, uploadFile]);

  const handleRefinementGenerateIntent = useCallback(
    (line: string): boolean => {
      const t = line.trim();
      if (!t || refinementAutoStartedRef.current) return false;
      const lower = t.toLowerCase();
      const isGenerateIntent =
        lower === "generate" ||
        lower === "start job" ||
        /^(please\s+)?(generate|start|run|create)(\s+now)?[.!?]*$/i.test(t) ||
        GENERATE_TRIGGER_RE.test(t);
      if (!isGenerateIntent) return false;
      refinementAutoStartedRef.current = true;
      return true;
    },
    [],
  );

  const handleRefinementOpenTypedAnswer = useCallback(
    (fieldKey: string) => {
      if (!user?.id) return;
      void trackAha(supabase, user.id, "refine_open_answer_submitted", {
        fieldKey,
      });
    },
    [supabase, user?.id],
  );

  /* Personalized refinement: sync remote step state + fetch plan (async in IIFE). */
  useEffect(() => {
    if (!refinementOpen) {
      refinementFetchAbortRef.current?.abort();
      refinementFetchAbortRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when closing refinement panel
      setClipRefinementRemote(undefined);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRefinementPlanInference(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRefinementSessionPlanKey("");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRefinementPersistenceSessionId("");
      return;
    }

    const ac = new AbortController();
    refinementFetchAbortRef.current = ac;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show loading before async plan fetch
    setClipRefinementRemote({ phase: "loading" });

    void (async () => {
      try {
        const out = await runClipRefinementFetch(ac.signal);
        if (ac.signal.aborted) return;
        setClipRefinementRemote({ phase: "ready", steps: out.steps });
        if (user?.id) {
          void trackAha(supabase, user.id, "refine_plan_loaded", {
            questionCount: out.steps.length,
          });
          if (out.detectedPurpose?.trim()) {
            void trackAha(supabase, user.id, "refine_plan_purpose_detected", {
              detectedPurpose: out.detectedPurpose.trim(),
            });
          }
        }
        if (typeof out.detectedPurpose === "string" && out.detectedPurpose.trim()) {
          setRefinementPlanInference({
            inferredClipPurpose: out.detectedPurpose.trim(),
            ...(out.purposeRationale?.trim()
              ? { inferredPurposeRationale: out.purposeRationale.trim() }
              : {}),
          });
        } else {
          setRefinementPlanInference(null);
        }
      } catch (e) {
        if ((e as Error).name === "AbortError" || ac.signal.aborted) return;
        const message =
          e instanceof Error ? e.message : "Could not load refinement questions.";
        setClipRefinementRemote({
          phase: "error",
          message,
          onRetry: () => setRefinementRetry((n) => n + 1),
        });
      }
    })();

    return () => {
      ac.abort();
    };
  }, [
    refinementOpen,
    refinementSessionPlanKey,
    refinementRetry,
    runClipRefinementFetch,
    supabase,
    user?.id,
  ]);

  const loadGeneration = useCallback(
    async (id: string) => {
      if (!user) return;
      const { data, error } = await supabase
        .from("generations")
        .select(
          "id, input_text, input_url, output, generation_context, updated_at",
        )
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error || !data) {
        setError("Could not load that generation.");
        return;
      }
      void trackAha(supabase, user.id, "session_restored", {
        generation_id: id,
      });
      const output = String(data.output ?? "");
      const extracted = extractPlatformSection(
        output,
        "clip_package",
        CLIP_PLATFORMS,
      ).trim();
      const rawBody =
        extracted ||
        (/TOP CLIP MOMENTS/i.test(output) ? output.trim() : "");
      const pkg = parseClipPackageSections(
        rawBody.length > 0 ? rawBody : output,
      );
      const gc = isGenerationContextV1(data.generation_context)
        ? data.generation_context
        : null;

      const inputUrl = data.input_url?.trim() ?? "";
      const inputText = data.input_text ?? "";
      let mode: "text" | "url" | "file" = "text";
      let userMessage = "Saved clip";
      if (inputUrl.startsWith("file:")) {
        mode = "text";
        userMessage = buildUserMessageSummary(
          inputText,
          "",
          null,
          "text",
        );
      } else if (inputUrl) {
        mode = "url";
        userMessage = buildUserMessageSummary("", inputUrl, null, "url");
      } else {
        userMessage = buildUserMessageSummary(
          inputText,
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
          timestamp: new Date(data.updated_at),
          parsedClipPackage: pkg,
          rawText: output,
          generationId: data.id,
          generationContext: gc,
          isRestored: true,
        },
      ]);
      setStreamedText("");
      setGenerationSteps([]);
      setLiveTurnSnapshot(null);
      setLastClipGenerationContext(gc);
      setUploadFile(null);
      if (inputUrl.startsWith("file:")) {
        setInputMode("text");
        setText(inputText);
        setUrl("");
      } else if (inputUrl) {
        setInputMode("url");
        setUrl(inputUrl);
        setText("");
      } else {
        setInputMode("text");
        setText(inputText);
        setUrl("");
      }
      setError(null);
      setWorkspaceTab("clip");
      setMobileNavOpen(false);
    },
    [user, supabase],
  );

  const fetchGenerationRecents = useCallback(async () => {
    if (!user) {
      setGenerationSidebarRecents([]);
      return;
    }
    const { data, error } = await supabase
      .from("generations")
      .select("id, title, input_text, input_url, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (error || !data) return;
    setGenerationSidebarRecents(
      data.map((row) => {
        const id = String(row.id);
        const label =
          row.title?.trim() ||
          row.input_text?.trim()?.slice(0, 40) ||
          row.input_url?.trim()?.slice(0, 40) ||
          "Untitled";
        return {
          id,
          label,
          updatedAt: row.updated_at,
          onSelect: () => void loadGeneration(id),
        };
      }),
    );
  }, [user, supabase, loadGeneration]);

  useEffect(() => {
    void fetchGenerationRecents();
  }, [fetchGenerationRecents]);

  const runGeneration = useCallback(async () => {
    setError(null);
    setCopiedId(null);

    const generationContext = pendingGenerationContextRef.current;
    const snap = pendingInputContentRef.current;
    const safeGenContext =
      generationContext != null
        ? sanitizeGenerationContextForTransport(generationContext)
        : null;
    const effectiveInputMode =
      safeGenContext != null ? snap.inputMode : inputMode;

    const genText = text.trim() || (safeGenContext ? snap.text : "");
    const genUrl = url.trim() || (safeGenContext ? snap.url : "");
    const genFile = uploadFile ?? (safeGenContext ? snap.uploadFile : null);

    if (effectiveInputMode === "text" && !genText.trim()) {
      setError("Paste an idea, transcript, or notes.");
      return;
    }
    if (effectiveInputMode === "url" && !genUrl.trim()) {
      setError("Enter a URL.");
      return;
    }
    if (effectiveInputMode === "file" && !genFile) {
      setError("Choose a file.");
      return;
    }

    if (!user && !creditsUnlimited) {
      const g = readGuestCreditsRemaining();
      if (g <= 0) {
        setGuestSignupGateOpen(true);
        setError("You've used your free previews. Create an account to continue.");
        return;
      }
    }

    pendingGenerationContextRef.current = null;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    setLoading(true);
    setProgress(8);
    startTsRef.current = null;
    setGenerationSteps([]);
    setStreamedText("");
    setLiveTurnSnapshot({
      userMessage: buildUserMessageSummary(
        genText,
        genUrl,
        genFile,
        effectiveInputMode,
      ),
      inputMode: effectiveInputMode,
      preset,
    });

    try {
      const titleSourceForProject =
        effectiveInputMode === "file"
          ? (genFile?.name ?? "")
          : effectiveInputMode === "url"
            ? genUrl.trim()
            : genText.trim();

      let res: Response;
      const presetPart = preset ? { preset } : {};
      const gcPart =
        safeGenContext != null ? { generationContext: safeGenContext } : {};

      if (effectiveInputMode === "file" && genFile) {
        res = await fetch("/api/generate", {
          method: "POST",
          credentials: "same-origin",
          signal,
          body: (() => {
            const fd = new FormData();
            fd.append("file", genFile);
            fd.append("platforms", JSON.stringify(CLIP_PLATFORMS));
            if (preset) fd.append("preset", preset);
            if (safeGenContext) {
              fd.append("generationContext", JSON.stringify(safeGenContext));
            }
            return fd;
          })(),
        });
      } else if (
        effectiveInputMode === "url" &&
        isYoutubeVideoUrlForTranscript(genUrl.trim())
      ) {
        let transcriptFromPrefetch = "";
        const urlTrim = genUrl.trim();
        const cached = youtubeTranscriptCacheRef.current;
        if (
          cached &&
          cached.url === urlTrim &&
          cached.transcript.trim()
        ) {
          transcriptFromPrefetch = cached.transcript.trim();
          setProgress(16);
        } else {
          setFetchingYoutubeTranscript(true);
          setProgress(10);
          try {
            const trRes = await fetch("/api/youtube-transcript", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal,
              body: JSON.stringify({ url: urlTrim }),
            });
            if (trRes.ok) {
              const data = (await trRes.json()) as { transcript?: string };
              transcriptFromPrefetch =
                typeof data.transcript === "string" ? data.transcript.trim() : "";
              if (transcriptFromPrefetch) {
                youtubeTranscriptCacheRef.current = {
                  url: urlTrim,
                  transcript: transcriptFromPrefetch,
                };
              }
            }
          } catch (e) {
            if ((e as Error).name === "AbortError") throw e;
          } finally {
            setFetchingYoutubeTranscript(false);
          }

          setProgress(16);
        }
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
              sourceUrl: genUrl.trim(),
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
              url: genUrl.trim(),
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
            mode: effectiveInputMode,
            text: effectiveInputMode === "text" ? genText : undefined,
            url: effectiveInputMode === "url" ? genUrl : undefined,
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

      const generationIdHeader = res.headers.get("x-genex-generation-id");
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
            setLiveTurnSnapshot(null);
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
            setLiveTurnSnapshot(null);
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
          "Generation didn't return any content. No credits were charged. Please try again.",
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
              genText,
              genUrl,
              genFile,
              effectiveInputMode,
            ),
            inputMode: effectiveInputMode,
            preset,
            timestamp: new Date(),
            parsedClipPackage: pkg,
            rawText: accumulated,
            generationId: generationIdHeader,
            generationContext: lastClipGenerationContext,
          },
        ]);
        if (user && generationIdHeader) {
          void fetch(`/api/generations/${generationIdHeader}`, {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: autoTitle(titleSourceForProject),
            }),
          });
          void (async () => {
            try {
              const purpose =
                lastClipGenerationContext?.inferredClipPurpose?.trim();
              await fetch("/api/memory/save", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  generationId: generationIdHeader,
                  outputText: accumulated,
                  inputContent: titleSourceForProject,
                  platforms: CLIP_PLATFORMS,
                  ...(purpose ? { detectedPurpose: purpose } : {}),
                }),
              });
            } catch {
              /* memory save is best-effort */
            } finally {
              void fetchGenerationRecents();
            }
          })();
          const nowIso = new Date().toISOString();
          setRecentProjectSessions((prev) => {
            const optimisticSession: ProjectSession = {
              id: generationIdHeader,
              title: autoTitle(titleSourceForProject),
              inputContent: titleSourceForProject,
              inputType:
                effectiveInputMode === "url"
                  ? "url"
                  : effectiveInputMode === "file"
                    ? "text"
                    : titleSourceForProject.length < 120 &&
                        titleSourceForProject.split(/\s+/).filter(Boolean)
                          .length <= 18
                      ? "idea"
                      : "text",
              outputText: accumulated,
              createdAt: nowIso,
              updatedAt: nowIso,
              inputText:
                effectiveInputMode === "text" ||
                effectiveInputMode === "file"
                  ? titleSourceForProject
                  : null,
              inputUrl:
                effectiveInputMode === "url" ? titleSourceForProject : null,
              generationKind: "clip_package",
            };
            const rest = prev.filter((p) => p.id !== generationIdHeader);
            return [optimisticSession, ...rest].slice(0, 20);
          });
        }
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
    fetchGenerationRecents,
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
          (clip.generationKind === "generic" ? "Text generation" : "Saved clip");
        return { ...clip, title: deriveClipTitle(clip.output, fallback) };
      }),
    [clips],
  );

  const emptyClipSectionMap = (): ClipSectionMap => ({
    moments: "",
    hooks: "",
    script: "",
    cta: "",
    caption_hashtags: "",
    broll: "",
    creator_signals: "",
  });

  const openClip = useCallback((clip: ClipPackageHistoryItem) => {
    const isGeneric = clip.generationKind === "generic";
    let pkg: ClipSectionMap;
    if (isGeneric) {
      const body = clip.output.trim();
      pkg = { ...emptyClipSectionMap(), script: body || "(empty output)" };
    } else {
      const extracted = extractPlatformSection(
        clip.output,
        "clip_package",
        CLIP_PLATFORMS,
      ).trim();
      const rawBody =
        extracted ||
        (/TOP CLIP MOMENTS/i.test(clip.output) ? clip.output.trim() : "");
      pkg = parseClipPackageSections(
        rawBody.length > 0 ? rawBody : clip.output,
      );
    }

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
  }, []);

  const restoreProjectById = useCallback(
    async (id: string) => {
      if (!user) return;
      void trackAha(supabase, user.id, "project_restored", {
        generation_id: id,
      });
      const res = await fetch(`/api/generations/${id}`, {
        credentials: "same-origin",
      });
      const json = (await res.json()) as {
        data: ProjectSession | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "Could not load project.");
        return;
      }
      openClip(projectSessionToClipPackageItem(json.data));
      setWorkspaceTab("clip");
      setMobileNavOpen(false);
    },
    [user, supabase, openClip],
  );

  const handleNewProject = useCallback(() => {
    if (user) void trackAha(supabase, user.id, "new_project_started");
    setText("");
    setUrl("");
    setUploadFile(null);
    setTurns([]);
    setStreamedText("");
    setGenerationSteps([]);
    setLiveTurnSnapshot(null);
    setError(null);
    setInputMode("text");
    setWorkspaceTab("clip");
    setMobileNavOpen(false);
  }, [user, supabase]);

  const sidebarRecentItems = useMemo(() => {
    const fromGenerations = generationSidebarRecents;

    if (!user) {
      return myClipCards.map((clip) => ({
        id: clip.id,
        label: clip.title,
        updatedAt: clip.createdAt,
        onSelect: () => {
          openClip(clip);
          setMobileNavOpen(false);
          setWorkspaceTab("clip");
        },
      }));
    }

    const genIds = new Set(fromGenerations.map((x) => x.id));
    const fromSessions = recentProjectSessions
      .filter((s) => !genIds.has(s.id))
      .map((s) => ({
        id: s.id,
        label: s.title,
        updatedAt: s.updatedAt,
        onSelect: () => {
          void restoreProjectById(s.id);
        },
      }));

    const apiIds = new Set([
      ...fromGenerations.map((x) => x.id),
      ...fromSessions.map((x) => x.id),
    ]);
    const extras = myClipCards
      .filter((c) => !apiIds.has(c.id))
      .map((clip) => ({
        id: clip.id,
        label: clip.title,
        updatedAt: clip.createdAt,
        onSelect: () => {
          openClip(clip);
          setMobileNavOpen(false);
          setWorkspaceTab("clip");
        },
      }));

    return [...fromGenerations, ...fromSessions, ...extras];
  }, [
    user,
    generationSidebarRecents,
    recentProjectSessions,
    myClipCards,
    restoreProjectById,
    openClip,
  ]);

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
      <p className="px-3 text-xs text-white/45">
        No saved generations yet. Run a clip or chat to build your history.
      </p>
    ) : (
      <>
        <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-widest text-white/40">
          Recents
        </p>
        <p className="px-3 pb-2 text-[10px] leading-snug text-white/35">
          Past generated content — tap to open in Write Content.
        </p>
        <div className="flex max-h-[min(42vh,22rem)] flex-col gap-1 overflow-y-auto pr-1">
          {(() => {
            let lastGroup: string | null = null;
            return sidebarRecentItems.map((item) => {
              const group =
                sidebarRecentItems.length >= 5
                  ? recentDateGroup(item.updatedAt)
                  : null;
              const showGroupLabel =
                Boolean(group) &&
                group !== lastGroup &&
                sidebarRecentItems.length >= 5;
              if (group != null) lastGroup = group;
              return (
                <div key={item.id} className="space-y-0.5">
                  {showGroupLabel ? (
                    <p className="px-3 pt-1 text-[10px] font-medium uppercase tracking-widest text-white/40">
                      {group}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      item.onSelect();
                      setMobileNavOpen(false);
                    }}
                    className="truncate rounded-lg px-3 py-2 text-left text-sm text-white/80 transition-colors hover:bg-white/10"
                  >
                    {item.label}
                  </button>
                </div>
              );
            });
          })()}
        </div>
      </>
    );

  const recentDropdown = (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-2 rounded-[32px] border border-white/48 py-2 pl-3 pr-4 text-sm font-medium tracking-[0.14px] text-white transition-colors hover:bg-white/10 font-[family-name:var(--font-instrument-sans)]"
      >
        <Clock className="size-4 shrink-0 text-white" aria-hidden />
        Recents
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 min-w-56 overflow-y-auto border border-ada-border bg-ada-card text-ada-primary"
      >
        {sidebarRecentItems.length === 0 ? (
          <div className="px-3 py-2 text-sm text-ada-secondary">
            No saved generations yet.
          </div>
        ) : (
          (() => {
            let lastGroup: string | null = null;
            return sidebarRecentItems.map((item) => {
              const group =
                sidebarRecentItems.length >= 5
                  ? recentDateGroup(item.updatedAt)
                  : null;
              const showGroupLabel =
                Boolean(group) &&
                group !== lastGroup &&
                sidebarRecentItems.length >= 5;
              if (group != null) lastGroup = group;
              return (
                <div key={item.id}>
                  {showGroupLabel ? (
                    <DropdownMenuLabel className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest text-ada-disabled">
                      {group}
                    </DropdownMenuLabel>
                  ) : null}
                  <DropdownMenuItem
                    onClick={() => {
                      item.onSelect();
                    }}
                  >
                    {item.label}
                  </DropdownMenuItem>
                </div>
              );
            });
          })()
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
    if (user) {
      openUpgrade("manual");
    } else {
      setBuyOpen(true);
    }
  }, [workspaceTab, user, openUpgrade]);

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
                  onUpgrade={() =>
                    user ? openUpgrade("no_credits") : setGuestSignupGateOpen(true)
                  }
                  onGuestExhausted={() => setGuestSignupGateOpen(true)}
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
                onSubmit={beginClipRefinement}
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
                  onSubmit={beginClipRefinement}
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
                  onRegenerate={beginClipRefinement}
                  variant="adaKit"
                  onTextVideoCreditsRemainingChange={(n) => {
                    if (!creditsUnlimited) setCreditsRemaining(n);
                  }}
                  refinementOpen={refinementOpen}
                  refinementRemote={clipRefinementRemote}
                  refinementPlanKey={refinementSessionPlanKey}
                  refinementPersistenceSessionId={
                    refinementPersistenceSessionId
                  }
                  refinementPrefillInference={
                    refinementPlanInference ?? undefined
                  }
                  onRefinementOpenTypedAnswer={handleRefinementOpenTypedAnswer}
                  onRefinementGenerateIntent={handleRefinementGenerateIntent}
                  refinementPlatformIds={CLIP_PLATFORMS}
                  refinementInputSummary={
                    pendingInputSummaryRef.current || "Text / idea"
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
                    window.setTimeout(() => beginClipRefinement(), 400);
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
                    footerOnly={false}
                    user={user}
                    creditsRemaining={creditsRemaining}
                    creditsUnlimited={creditsUnlimited}
                    creditMeterDenom={creditMeterMax}
                    workspaceTab={workspaceTab}
                    onWorkspaceTab={(t) => {
                      setWorkspaceTab(t);
                      setClipSettingsOpen(false);
                    }}
                    onNewProject={() => {
                      handleNewProject();
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

      <GuestSignupGateOverlay open={guestSignupGateOpen} nextPath="/" />

      <Dialog
        open={signInOpen}
        onOpenChange={(open) => {
          setSignInOpen(open);
          if (!open && (authError ?? authSuccess)) {
            router.replace("/");
          }
        }}
      >
        <DialogContent
          showCloseButton
          overlayClassName="bg-black/55 supports-backdrop-filter:backdrop-blur-sm"
          className="max-h-[min(90dvh,920px)] w-[calc(100%-1.5rem)] max-w-[min(1024px,calc(100%-1.5rem))] gap-0 overflow-hidden border-0 bg-transparent p-0 text-white ring-white/15 sm:max-w-[min(1024px,calc(100%-2rem))]"
        >
          <DialogTitle className="sr-only">Log in</DialogTitle>
          <div className="relative flex max-h-[min(90dvh,920px)] flex-col overflow-hidden rounded-xl border border-white/12 bg-[#0A050F] shadow-[0_24px_80px_rgba(0,0,0,0.45)] lg:flex-row">
            <AdaFigmaAmbientBackground />
            <div className="relative z-[1] flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-8 sm:px-10 lg:max-w-[min(420px,100%)] lg:justify-center lg:py-10">
              <AdaLoginPanel
                next={signInNext}
                authError={authError ?? null}
                onDismiss={() => {
                  setSignInOpen(false);
                  if (authError ?? authSuccess) router.replace("/");
                }}
              />
            </div>
            <div className="relative z-[1] border-t border-white/10 lg:hidden">
              <AdaMarketingPanel className="min-h-0 pt-10 pb-8 sm:px-10 sm:pt-12 lg:min-h-0 lg:max-w-none" />
            </div>
            <div className="relative z-[1] hidden min-h-0 min-w-0 flex-1 overflow-y-auto border-t border-white/10 lg:block lg:border-l lg:border-t-0">
              <AdaMarketingPanel className="lg:min-h-0 lg:max-w-none lg:flex-1 lg:pt-14 lg:pb-8" />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <BuyCreditsDialog
        open={buyOpen}
        onOpenChange={setBuyOpen}
        creditsRemaining={creditsRemaining}
        creditsUnlimited={creditsUnlimited}
        signedIn={Boolean(user)}
      />

      <AdaUpgradeModal
        open={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
        creditsRemaining={creditsRemaining}
        creditsUnlimited={creditsUnlimited}
        creditMeterDenom={creditMeterMax}
        trigger={upgradeTrigger}
        variant="adaKit"
        signedIn={Boolean(user)}
      />
    </>
  );
}

function BuyCreditsDialog({
  open,
  onOpenChange,
  creditsRemaining,
  creditsUnlimited,
  signedIn,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  creditsRemaining: number;
  creditsUnlimited: boolean;
  signedIn: boolean;
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
          <DialogTitle>Credits & plans</DialogTitle>
          <DialogDescription>
            {creditsUnlimited ? (
              <>Test mode: <strong>unlimited</strong> credits.</>
            ) : (
              <>
                You have <strong>{creditsRemaining}</strong> credits remaining.
                {signedIn
                  ? " Choose a plan (3-day trial) or open Upgrade for top-ups."
                  : " Create an account to subscribe and unlock monthly credits."}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {!signedIn ? (
            <Link
              href="/auth/sign-up?next=%2F"
              className="inline-flex items-center justify-center rounded-ada-input bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF] px-4 py-2 text-center text-sm font-semibold text-white no-underline"
            >
              Create account
            </Link>
          ) : null}
          <Link
            href="/onboarding/plan?next=%2F"
            className="inline-flex items-center justify-center rounded-ada-input border border-ada-border bg-transparent px-4 py-2 text-center text-sm font-medium text-ada-primary no-underline hover:bg-ada-card-hover"
          >
            View plans & trial
          </Link>
        </div>

        <div className="space-y-2 rounded-lg border border-dashed border-ada-border-active bg-ada-app/80 p-4">
          <Label htmlFor="waitlist-email">Optional: product waitlist</Label>
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
