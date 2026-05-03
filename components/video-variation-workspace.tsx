"use client";

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { GenerationFeedbackPanel } from "@/components/generation-feedback-panel";
import { LazyVideoPlayer } from "@/components/lazy-video-player";
import { SettingsRail } from "@/components/genex/settings-rail";
import { RefinementChatPanel } from "@/components/refinement-chat-panel";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import {
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Film,
  Menu,
  MessageSquare,
  Mic,
  Paperclip,
  RefreshCw,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

import {
  normalizeVariationCount,
  validateDurationOptions,
} from "@/lib/clip-generation-options";
import type { ClipLengthMode } from "@/lib/clip-generation-options";
import { trackAha } from "@/lib/analytics";
import type { VideoVariationItem, VideoJobStatus } from "@/lib/video-job-types";
import { VIDEO_JOB_CREDIT_COST } from "@/lib/video-job-cost";
import { createClient } from "@/lib/supabase/client";
import type { GenerationContextV1 } from "@/lib/generation-context";
import {
  isGenerationContextV1,
  sanitizeGenerationContextForTransport,
} from "@/lib/generation-context";
import type { PlatformId } from "@/lib/platforms";
import { shouldUseUnifiedVideoClipCoach } from "@/lib/video-clip-coach-toggle";
import { cn } from "@/lib/utils";

type Props = {
  user: { id: string; email: string } | null;
  creditsRemaining: number;
  creditsUnlimited: boolean;
  setCreditsRemaining: (n: number) => void;
  onOpenBuy: () => void;
  onOpenSignIn: () => void;
  onJobFinished: () => void;
  /** Opens the app navigation drawer on small screens (dashboard shell). */
  onOpenMobileNav?: () => void;
  /** When embedded in the global landing shell, omit the internal marketing hero. */
  hideMarketingTitle?: boolean;
  /** Parent shell provides top chrome (e.g. Ada video workspace header). */
  omitChromeHeader?: boolean;
  /**
   * Ada kit: show a compact “Clip coach” dropdown on the composer (no separate rail).
   * When enabled, refinement uses `clip_first` coach + job setup in one panel.
   */
  embedClipCoach?: boolean;
};

type JobRow = {
  id: string;
  status: VideoJobStatus;
  input_type?: string;
  storage_path?: string | null;
  pending_storage_path?: string | null;
  variations?: unknown;
  error_message?: string | null;
  updated_at?: string;
  generation_context?: unknown;
};

const PIPELINE_STEPS = [
  "Queued",
  "Transcribing",
  "Planning",
  "Generating",
  "Done",
] as const;

const VIDEO_REFINEMENT_PLATFORMS: PlatformId[] = [
  "tiktok",
  "youtube_shorts",
  "clip_package",
];

const REFINEMENT_GENERATE_COMMANDS = [
  "generate",
  "go",
  "just generate",
  "generate now",
  "do it",
  "just do it",
  "skip",
  "start",
  "run",
  "create",
  "make it",
  "submit",
  "done",
  "finish",
  "continue",
  "proceed",
];

/** Figma 82-2990 — video hub suggestion tiles (gradient “thumbnails” + prompt). */
const VIDEO_HUB_CAROUSEL_CARDS: { prompt: string; thumb: string }[] = [
  {
    prompt: "Man on a motorbike on the highway",
    thumb:
      "linear-gradient(145deg, #1a1038 0%, #2d1b4e 50%, #4a2c6a 100%), linear-gradient(200deg, rgba(211,28,215,0.25) 0%, transparent 50%)",
  },
  {
    prompt: "Girls playing volleyball on the beach",
    thumb:
      "linear-gradient(145deg, #0d2840 0%, #1e5070 45%, #3a7a9c 100%), linear-gradient(165deg, rgba(255,180,120,0.22) 0%, transparent 55%)",
  },
  {
    prompt: "Bears on the forest hunting by the river",
    thumb:
      "linear-gradient(145deg, #0f2818 0%, #1a3d28 48%, #2d5a38 100%), linear-gradient(190deg, rgba(80,140,90,0.3) 0%, transparent 50%)",
  },
  {
    prompt: "Help with a homework assignment.",
    thumb:
      "linear-gradient(145deg, #2a1a40 0%, #4a3080 50%, #6b48a8 100%), linear-gradient(210deg, rgba(136,0,220,0.28) 0%, transparent 48%)",
  },
];

function normalizeYoutubeUrlForJob(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(www\.)?(youtube\.com|youtu\.be)\b/i.test(t)) {
    return `https://${t.replace(/^\/+/, "")}`;
  }
  return t;
}

function isValidHttpUrl(s: string): boolean {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Stable for one refine session; must not track live composer text after refine opens. */
function buildVideoRefinementSessionPlanKey(opts: {
  promptSnippet: string;
  videoFile: File | null;
  youtubeUrl: string;
}): string {
  const p = opts.promptSnippet.trim().slice(0, 400);
  if (opts.videoFile) {
    return `file:${opts.videoFile.name}:${opts.videoFile.size}:${p}`;
  }
  return `url:${normalizeYoutubeUrlForJob(opts.youtubeUrl)}:${p}`;
}

async function postVideoJobUrlJson(params: {
  prompt: string;
  youtubeUrl: string;
  generationContext?: GenerationContextV1 | null;
}): Promise<{ id: string; remainingCredits?: number }> {
  const res = await fetch("/api/video-jobs", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputType: "url",
      prompt: params.prompt,
      youtubeUrl: params.youtubeUrl,
      ...(params.generationContext
        ? { generationContext: params.generationContext }
        : {}),
    }),
  });
  const data = (await res.json()) as {
    id?: string;
    remainingCredits?: number;
    error?: string;
    message?: string;
  };
  if (!res.ok || !data.id) {
    throw new Error(
      String(data.message || data.error || res.statusText || "Request failed."),
    );
  }
  return { id: data.id, remainingCredits: data.remainingCredits };
}

/** PUT to Supabase signed upload URL (same shape as @supabase/storage-js uploadToSignedUrl). */
function putVideoToSignedUploadUrl(
  signedUrl: string,
  file: File,
  onProgress: (pct: number) => void,
  onUploadFullySent?: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    // Must match `createSignedUploadUrl(..., { upsert: true })` in /api/video-jobs.
    xhr.setRequestHeader("x-upsert", "true");
    xhr.timeout = 320_000;
    const fd = new FormData();
    fd.append("cacheControl", "3600");
    fd.append("", file);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.min(99, Math.round((100 * e.loaded) / e.total)));
      }
    };
    xhr.upload.onload = () => {
      onProgress(99);
      onUploadFullySent?.();
    };
    xhr.ontimeout = () =>
      reject(
        new Error(
          "Upload timed out. Try a smaller file or check your connection.",
        ),
      );
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let msg = xhr.statusText;
      try {
        const j = JSON.parse(xhr.responseText) as {
          message?: string;
          error?: string;
        };
        if (j.message) msg = j.message;
        else if (j.error) msg = j.error;
      } catch {
        if (xhr.responseText) msg = xhr.responseText.slice(0, 500);
      }
      reject(new Error(msg || "Storage upload failed."));
    };
    xhr.onerror = () =>
      reject(new Error("Network error during upload to storage."));
    xhr.send(fd);
  });
}

async function submitUploadJobViaDirectStorage(params: {
  file: File;
  prompt: string;
  generationContext?: GenerationContextV1 | null;
  onProgress: (pct: number) => void;
  onUploadFullySent?: () => void;
}): Promise<{ id: string; remainingCredits?: number }> {
  const prepRes = await fetch("/api/video-jobs", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputType: "upload",
      prepareDirectUpload: true,
      prompt: params.prompt,
      filename: params.file.name,
      bytes: params.file.size,
      contentType: params.file.type || "video/mp4",
      ...(params.generationContext
        ? { generationContext: params.generationContext }
        : {}),
    }),
  });
  const prep = (await prepRes.json()) as {
    id?: string;
    remainingCredits?: number;
    directUpload?: { signedUrl?: string };
    error?: string;
    message?: string;
  };
  if (!prepRes.ok || !prep.id) {
    throw new Error(
      String(
        prep.message ||
          prep.error ||
          prepRes.statusText ||
          "Could not start upload.",
      ),
    );
  }
  const signedUrl = prep.directUpload?.signedUrl;
  if (!signedUrl) {
    throw new Error("Server did not return a signed upload URL.");
  }

  await putVideoToSignedUploadUrl(
    signedUrl,
    params.file,
    params.onProgress,
    params.onUploadFullySent,
  );

  const finRes = await fetch(`/api/video-jobs/${prep.id}`, {
    method: "PATCH",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ finalizeDirectUpload: true }),
  });
  const fin = (await finRes.json()) as {
    ok?: boolean;
    error?: string;
    message?: string;
  };
  if (!finRes.ok || !fin.ok) {
    throw new Error(
      String(
        fin.message ||
          fin.error ||
          "Could not finalize upload. If the file is still transferring, wait and try submitting again.",
      ),
    );
  }

  params.onProgress(100);
  return { id: prep.id, remainingCredits: prep.remainingCredits };
}

function statusToStep(status: VideoJobStatus): number {
  switch (status) {
    case "queued":
    case "processing":
      return 0;
    case "transcribing":
    case "analyzing":
      return 1;
    case "planning":
      return 2;
    case "generating":
      return 3;
    case "complete":
      return 4;
    default:
      return 0;
  }
}

function statusToPipelineProgress(status: VideoJobStatus): number {
  switch (status) {
    case "queued":
      return 8;
    case "processing":
      return 14;
    case "transcribing":
    case "analyzing":
      return 32;
    case "planning":
      return 55;
    case "generating":
      return 78;
    case "complete":
      return 100;
    default:
      return 0;
  }
}

function formatVariationsForFeedback(list: VideoVariationItem[]): string {
  return list
    .map((v) => {
      const n = v.variation_number ?? 0;
      const err =
        typeof v.error === "string" && v.error ? `Error: ${v.error}` : "";
      const url = typeof v.url === "string" && v.url ? `Output: ${v.url}` : "";
      return `Variation ${n}: ${v.label}\nNotes: ${v.style_note ?? ""}\n${err || url}`;
    })
    .join("\n\n---\n\n");
}

function parseVariations(raw: unknown): VideoVariationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is VideoVariationItem => {
    if (typeof x !== "object" || x === null || !("url" in x)) return false;
    const rec = x as VideoVariationItem;
    if (typeof rec.error === "string" && rec.error.length > 0) return true;
    const u = rec.url;
    return typeof u === "string" && u.length > 0;
  });
}

type VariationPreviewRegistry = {
  register: (id: string, pause: () => void) => void;
  unregister: (id: string) => void;
  /** Pause every registered preview except `id`, then caller may play `id`. */
  activateExclusive: (id: string) => void;
};

const VariationPreviewRegistryContext =
  createContext<VariationPreviewRegistry | null>(null);

function VariationPreviewRegistryProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pausersRef = useRef(new Map<string, () => void>());

  const registry = useMemo<VariationPreviewRegistry>(
    () => ({
      register(id, pause) {
        pausersRef.current.set(id, pause);
      },
      unregister(id) {
        pausersRef.current.delete(id);
      },
      activateExclusive(id) {
        pausersRef.current.forEach((pause, key) => {
          if (key !== id) pause();
        });
      },
    }),
    [],
  );

  return (
    <VariationPreviewRegistryContext.Provider value={registry}>
      {children}
    </VariationPreviewRegistryContext.Provider>
  );
}

/** One live decode at a time (exclusive hover), poster still when idle; `preload=metadata` until play. */
function VariationHoverVideo({
  src,
  instanceId,
}: {
  src: string;
  instanceId: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const preview = useContext(VariationPreviewRegistryContext);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const posterDoneRef = useRef(false);
  const [posterLayoutKey, setPosterLayoutKey] = useState(0);

  const onLazyVideoReady = useCallback(() => {
    setPosterLayoutKey((k) => k + 1);
  }, []);

  const pauseStill = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
  }, []);

  useEffect(() => {
    preview?.register(instanceId, pauseStill);
    return () => preview?.unregister(instanceId);
  }, [preview, instanceId, pauseStill]);

  /* Poster resets when `src` changes; initial null is intentional before captureStill. */
  useEffect(() => {
    posterDoneRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset poster when video src changes
    setPosterUrl(null);
    const el = ref.current;
    if (!el) return;

    const captureStill = () => {
      if (posterDoneRef.current) return;
      try {
        const w = el.videoWidth;
        const h = el.videoHeight;
        if (!w || !h) return;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(el, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        posterDoneRef.current = true;
        setPosterUrl(dataUrl);
      } catch {
        /* CORS-tainted canvas or decode guard */
      }
    };

    const onLoadedData = () => {
      if (posterDoneRef.current) return;
      const dur = Number.isFinite(el.duration) ? el.duration : 0;
      const t = dur > 0 ? Math.min(0.08, Math.max(0.001, dur * 0.02)) : 0.05;
      el.currentTime = t;
    };

    const onSeeked = () => {
      el.removeEventListener("seeked", onSeeked);
      captureStill();
      el.currentTime = 0;
    };

    el.addEventListener("loadeddata", onLoadedData, { once: true });
    el.addEventListener("seeked", onSeeked);

    if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      onLoadedData();
    }

    return () => {
      el.removeEventListener("loadeddata", onLoadedData);
      el.removeEventListener("seeked", onSeeked);
    };
  }, [src, posterLayoutKey]);

  const play = () => {
    const el = ref.current;
    if (!el) return;
    preview?.activateExclusive(instanceId);
    el.muted = true;
    void el.play().catch(() => {});
  };

  return (
    <div
      className="group relative isolate overflow-hidden bg-black"
      style={{ contain: "layout style" }}
      onMouseEnter={play}
      onMouseLeave={pauseStill}
      onClick={() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        if (window.matchMedia("(hover: hover) and (pointer: fine)").matches)
          return;
        const el = ref.current;
        if (!el) return;
        if (el.paused) {
          preview?.activateExclusive(instanceId);
          el.muted = true;
          void el.play().catch(() => {});
        } else {
          pauseStill();
        }
      }}
    >
      <LazyVideoPlayer
        ref={ref}
        src={src}
        poster={posterUrl ?? undefined}
        className="aspect-9/16 max-h-[min(560px,70vh)] w-full transform-gpu bg-black"
        videoClassName="h-full w-full transform-gpu object-cover"
        muted
        playsInline
        loop
        controls
        crossOrigin="anonymous"
        preload="metadata"
        onVideoMount={onLazyVideoReady}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center transition-opacity duration-300 group-hover:opacity-0"
      >
        <span className="rounded-full bg-black/65 px-3 py-1 text-[11px] text-white/95 shadow-sm backdrop-blur-sm">
          Hover to preview
        </span>
      </div>
    </div>
  );
}

export type VideoVariationWorkspaceHandle = {
  openSettings: () => void;
};

export const VideoVariationWorkspace = forwardRef<
  VideoVariationWorkspaceHandle,
  Props
>(function VideoVariationWorkspace(props, ref) {
  const {
    user,
    creditsRemaining,
    creditsUnlimited,
    setCreditsRemaining,
    onOpenBuy,
    onOpenSignIn,
    onJobFinished,
    onOpenMobileNav,
    hideMarketingTitle = false,
    omitChromeHeader = false,
    embedClipCoach = false,
  } = props;
  const [prompt, setPrompt] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const youtubeUrlRef = useRef<HTMLInputElement>(null);
  const videoHubCarouselRef = useRef<HTMLDivElement>(null);

  const openVideoFilePicker = useCallback(() => {
    window.setTimeout(() => fileRef.current?.click(), 0);
  }, []);

  const [uploadPct, setUploadPct] = useState(0);
  const [finishingOnServer, setFinishingOnServer] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<VideoJobStatus | null>(null);
  const [variations, setVariations] = useState<VideoVariationItem[]>([]);
  /** Server `error_message` when status is complete but some variations failed. */
  const [jobPartialNotice, setJobPartialNotice] = useState<string | null>(null);
  const [refinementOpen, setRefinementOpen] = useState(false);
  const [refinementSessionPlanKey, setRefinementSessionPlanKey] =
    useState("");
  const [refinementPersistenceSessionId, setRefinementPersistenceSessionId] =
    useState("");
  /** First clip instruction for this refine session; composer clears so follow-ups do not mutate this bubble. */
  const [refinementFrozenUserBubbleText, setRefinementFrozenUserBubbleText] =
    useState("");
  /** Same as frozen bubble; ref survives async gaps so job submit always has the root instruction. */
  const refinementRootClipInstructionRef = useRef("");
  const [jobGenerationContext, setJobGenerationContext] =
    useState<GenerationContextV1 | null>(null);
  /** Live refinement answers for clip coach before confirm (Ada kit only). */
  const [refinementDraftContext, setRefinementDraftContext] =
    useState<GenerationContextV1 | null>(null);
  const [clipCoachResetNonce, setClipCoachResetNonce] = useState(0);
  /** Ada kit only: Perplexity-style opt-in for clip_first coach inside refinement. */
  const [clipCoachEnabled, setClipCoachEnabled] = useState(false);
  const [lastSubmittedPrompt, setLastSubmittedPrompt] = useState("");

  const unifiedClipCoachActive = useMemo(
    () => shouldUseUnifiedVideoClipCoach(embedClipCoach, clipCoachEnabled),
    [embedClipCoach, clipCoachEnabled],
  );

  const refinementSendRef = useRef<((line: string) => Promise<void>) | null>(
    null,
  );
  const [refinementConvBusy, setRefinementConvBusy] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failedToastJobIdRef = useRef<string | null>(null);
  /** Parent often passes an inline callback; keep stable so polling `useEffect` does not reset every render. */
  const onJobFinishedRef = useRef(onJobFinished);
  useEffect(() => {
    onJobFinishedRef.current = onJobFinished;
  }, [onJobFinished]);

  useEffect(() => {
    if (!refinementOpen) {
      setRefinementDraftContext(null);
      setRefinementSessionPlanKey("");
      setRefinementPersistenceSessionId("");
      setRefinementFrozenUserBubbleText("");
      refinementRootClipInstructionRef.current = "";
    }
  }, [refinementOpen]);

  /** True while a direct-upload job is queued but `storage_path` is not linked yet (worker cannot claim). */
  const [jobAwaitingUploadLink, setJobAwaitingUploadLink] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /** 1 | 2 | 3 | 5 | custom — maps to variationCount after normalize. */
  const [variationPreset, setVariationPreset] = useState<
    "1" | "2" | "3" | "5" | "custom"
  >("3");
  const [variationCustomStr, setVariationCustomStr] = useState("6");
  const [clipLengthMode, setClipLengthMode] = useState<ClipLengthMode>("auto");
  const [minDurationStr, setMinDurationStr] = useState("");
  const [maxDurationStr, setMaxDurationStr] = useState("");

  useImperativeHandle(ref, () => ({
    openSettings: () => {
      setSettingsOpen(true);
    },
  }));

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const fetchJob = useCallback(async (id: string) => {
    const fetchOnce = async (slim: boolean) => {
      const url = `/api/video-jobs/${id}${slim ? "?slim=true" : ""}`;
      return fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
      });
    };

    const readErrorMessageFromText = (raw: string, statusText: string) => {
      let msg = raw || statusText;
      try {
        const j = JSON.parse(raw) as { error?: string; message?: string };
        if (j.message) msg = j.message;
        else if (j.error) msg = j.error;
      } catch {
        /* keep — e.g. HTML error page from gateway */
      }
      return msg;
    };

    const parseJobRow = (raw: string): JobRow | null => {
      try {
        return JSON.parse(raw) as JobRow;
      } catch {
        return null;
      }
    };

    try {
      let res = await fetchOnce(true);
      let raw = await res.text();
      if (!res.ok) {
        setError(
          `Could not load job (${res.status}): ${readErrorMessageFromText(raw, res.statusText)}`,
        );
        return;
      }
      setError(null);
      let row = parseJobRow(raw);
      if (!row || typeof row.status !== "string") {
        setError("Could not load job: invalid response from server.");
        return;
      }

      if (row.status === "complete") {
        res = await fetchOnce(false);
        raw = await res.text();
        if (!res.ok) {
          setError(
            `Could not load job (${res.status}): ${readErrorMessageFromText(raw, res.statusText)}`,
          );
          return;
        }
        const full = parseJobRow(raw);
        if (!full || typeof full.status !== "string") {
          setError("Could not load job: invalid response from server.");
          return;
        }
        row = full;
      }
    setJobStatus(row.status);
    const awaitingLink =
      row.status === "queued" &&
      row.input_type === "upload" &&
      !(typeof row.storage_path === "string" && row.storage_path.trim()) &&
      !!(
        typeof row.pending_storage_path === "string" &&
        row.pending_storage_path.trim()
      );
    setJobAwaitingUploadLink(awaitingLink);
    setVariations(parseVariations(row.variations));
    setJobPartialNotice(
      row.status === "complete" && row.error_message?.trim()
        ? row.error_message.trim()
        : null,
    );
    const gc = row.generation_context;
    setJobGenerationContext(isGenerationContextV1(gc) ? gc : null);

    if (row.status === "failed") {
      stopPoll();
      if (failedToastJobIdRef.current !== id) {
        failedToastJobIdRef.current = id;
        toast.error(row.error_message?.trim() || "Video job failed.");
      }
      return;
    }

    if (row.status === "complete") {
      stopPoll();
      if (row.error_message?.trim()) {
        toast.info(row.error_message.trim());
      }
      onJobFinishedRef.current();
    }
    } catch (e) {
      console.error("[video] fetchJob", e);
      setError(
        e instanceof Error
          ? e.message
          : "Could not refresh job status. Try reloading the page.",
      );
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;
    void fetchJob(jobId);
    pollRef.current = setInterval(() => void fetchJob(jobId), 3000);
    return stopPoll;
  }, [jobId, fetchJob]);

  const resetJobUi = (opts?: { keepSubmittedPrompt?: boolean }) => {
    stopPoll();
    setJobId(null);
    setJobStatus(null);
    setVariations([]);
    setJobPartialNotice(null);
    setJobGenerationContext(null);
    if (!opts?.keepSubmittedPrompt) setLastSubmittedPrompt("");
    setJobAwaitingUploadLink(false);
    setUploadPct(0);
    failedToastJobIdRef.current = null;
    setClipCoachResetNonce((n) => n + 1);
  };

  const refinementMainBarCanSend = useMemo(
    () =>
      refinementOpen &&
      !unifiedClipCoachActive &&
      !submitting &&
      !refinementConvBusy &&
      Boolean(prompt.trim()),
    [
      refinementOpen,
      unifiedClipCoachActive,
      submitting,
      refinementConvBusy,
      prompt,
    ],
  );

  const handleSubmit = () => {
    setError(null);
    if (!user) {
      onOpenSignIn();
      return;
    }
    if (refinementOpen && !submitting) {
      if (unifiedClipCoachActive) return;
      const rawLine = prompt.trim();
      const normalizedLine = rawLine.toLowerCase();
      const isGenerateCommand = REFINEMENT_GENERATE_COMMANDS.some(
        (cmd) =>
          normalizedLine === cmd ||
          normalizedLine.startsWith(`${cmd} `) ||
          normalizedLine.endsWith(` ${cmd}`),
      );
      if (isGenerateCommand) {
        setRefinementOpen(false);
        setPrompt("");
        queueMicrotask(() => {
          void submitWithRefinementContext(
            refinementDraftContext ?? {
              version: 1,
              kind: "video_variations",
              platforms: VIDEO_REFINEMENT_PLATFORMS,
              answers: {},
              confirmedAt: new Date().toISOString(),
            },
          );
        });
        return;
      }
      if (refinementSendRef.current) {
        if (!rawLine || refinementConvBusy) return;
        void refinementSendRef.current(rawLine);
        setPrompt("");
        return;
      }
      return;
    }
    if (!creditsUnlimited && creditsRemaining < VIDEO_JOB_CREDIT_COST) {
      onOpenBuy();
      setError(`You need at least ${VIDEO_JOB_CREDIT_COST} credits.`);
      return;
    }
    if (!prompt.trim()) {
      setError("Describe what you want the AI to do.");
      return;
    }
    if (videoFile) {
      // file from paperclip — upload path
    } else {
      const normalized = normalizeYoutubeUrlForJob(youtubeUrl);
      if (!isValidHttpUrl(normalized)) {
        setError(
          "Paste a YouTube link (https://… or youtube.com/…) or attach MP4/MOV with the paperclip.",
        );
        return;
      }
    }

    const rootClipInstruction = prompt.trim();
    setRefinementSessionPlanKey(
      buildVideoRefinementSessionPlanKey({
        promptSnippet: rootClipInstruction,
        videoFile,
        youtubeUrl,
      }),
    );
    setRefinementPersistenceSessionId(crypto.randomUUID());
    refinementRootClipInstructionRef.current = rootClipInstruction;
    setRefinementFrozenUserBubbleText(rootClipInstruction);
    setPrompt("");
    setRefinementOpen(true);
  };

  const hasInput = useMemo(() => {
    if (videoFile != null) return true;
    return isValidHttpUrl(normalizeYoutubeUrlForJob(youtubeUrl));
  }, [videoFile, youtubeUrl]);

  const refinementInputSummary = useMemo(() => {
    const base = videoFile
      ? `Upload: ${videoFile.name}`
      : `YouTube: ${normalizeYoutubeUrlForJob(youtubeUrl) || youtubeUrl.trim() || "…"}`;
    const goal = refinementFrozenUserBubbleText.trim();
    if (!goal) return base;
    return `${base}\n\nCreator clip goal:\n${goal}`;
  }, [videoFile, youtubeUrl, refinementFrozenUserBubbleText]);

  const clipCoachBriefPrefix = useMemo(() => {
    const parts: string[] = [];
    if (videoFile) {
      parts.push(`Source: uploaded file "${videoFile.name}"`);
    } else {
      const u = normalizeYoutubeUrlForJob(youtubeUrl);
      if (isValidHttpUrl(u)) parts.push(`Source: YouTube ${u}`);
    }
    const clipDraft =
      refinementFrozenUserBubbleText.trim() || prompt.trim();
    if (clipDraft) {
      parts.push(
        `Current clip instruction draft:\n${
          clipDraft.length > 1200
            ? `${clipDraft.slice(0, 1200)}…`
            : clipDraft
        }`,
      );
    }
    return parts.join("\n\n");
  }, [videoFile, youtubeUrl, prompt, refinementFrozenUserBubbleText]);

  const handleApplyCoachToPrompt = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    setPrompt((p) => {
      const base = p.trim();
      return base ? `${base}\n\n— From Ada clip coach —\n${t}` : t;
    });
    toast.success("Coach reply added to your clip prompt");
  }, []);

  const handleRefinementDraftForCoach = useCallback(
    (ctx: GenerationContextV1) => {
      setRefinementDraftContext(ctx);
    },
    [],
  );

  const clipCoachGenerationContext = useMemo(
    () => jobGenerationContext ?? refinementDraftContext,
    [jobGenerationContext, refinementDraftContext],
  );

  const submitWithRefinementContext = async (ctx: GenerationContextV1) => {
    const resolvedVariation =
      variationPreset === "custom"
        ? normalizeVariationCount(Number.parseInt(variationCustomStr, 10))
        : normalizeVariationCount(Number.parseInt(variationPreset, 10));

    const minParsed =
      clipLengthMode === "custom" && minDurationStr.trim() !== ""
        ? Number(minDurationStr)
        : null;
    const maxParsed =
      clipLengthMode === "custom" && maxDurationStr.trim() !== ""
        ? Number(maxDurationStr)
        : null;
    const minDurationSec =
      minParsed != null && Number.isFinite(minParsed) ? minParsed : null;
    const maxDurationSec =
      maxParsed != null && Number.isFinite(maxParsed) ? maxParsed : null;

    const dur = validateDurationOptions({
      clipLengthMode,
      minDurationSec,
      maxDurationSec,
    });
    if (!dur.ok) {
      toast.error(dur.message);
      return;
    }

    const mergedCtx: GenerationContextV1 = {
      ...ctx,
      variationCount: resolvedVariation,
      clipLengthMode,
      ...(clipLengthMode === "custom"
        ? { minDurationSec, maxDurationSec }
        : {}),
    };

    const clipInstruction =
      prompt.trim() ||
      refinementRootClipInstructionRef.current.trim() ||
      refinementFrozenUserBubbleText.trim();

    const safeCtx = sanitizeGenerationContextForTransport(mergedCtx);

    setRefinementOpen(false);
    setSubmitting(true);
    setUploadPct(0);
    setFinishingOnServer(false);
    resetJobUi();
    setLastSubmittedPrompt(clipInstruction);
    setJobGenerationContext(safeCtx);

    try {
      const { id, remainingCredits } =
        videoFile != null
          ? await submitUploadJobViaDirectStorage({
              file: videoFile,
              prompt: clipInstruction,
              generationContext: safeCtx,
              onProgress: setUploadPct,
              onUploadFullySent: () => setFinishingOnServer(true),
            })
          : await postVideoJobUrlJson({
              prompt: clipInstruction,
              youtubeUrl: normalizeYoutubeUrlForJob(youtubeUrl),
              generationContext: safeCtx,
            });
      if (typeof remainingCredits === "number") {
        setCreditsRemaining(remainingCredits);
      }
      setJobId(id);
      setJobStatus("queued");
      if (user) {
        const sb = createClient();
        void trackAha(sb, user.id, "video_job_submitted", {
          job_id: id,
          variation_count_selected: resolvedVariation,
          clip_length_mode_selected: clipLengthMode,
          custom_duration_used:
            clipLengthMode === "custom" &&
            (minDurationSec != null || maxDurationSec != null),
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed.";
      setError(msg);
      if (msg === "no_credits" || msg.includes("no_credits")) onOpenBuy();
    } finally {
      setSubmitting(false);
      setUploadPct(0);
      setFinishingOnServer(false);
    }
  };

  const activeStepIndex =
    jobStatus && jobStatus !== "failed" ? statusToStep(jobStatus) : -1;

  const pipelineProgressValue =
    jobStatus && jobStatus !== "failed"
      ? statusToPipelineProgress(jobStatus)
      : 0;

  const pipelineHeadline =
    jobStatus === "processing"
      ? "Starting"
      : jobStatus === "complete"
        ? "Done"
        : PIPELINE_STEPS[Math.min(activeStepIndex, 4)];

  const creditsLineForRail = creditsUnlimited
    ? "Unlimited (test)"
    : `${creditsRemaining} left`;

  const settingsRailProps = {
    mode: "video" as const,
    platformLabel: "TikTok · Shorts · Reels",
    creditsLine: creditsLineForRail,
  };

  const chatTitle = useMemo(() => {
    const t =
      lastSubmittedPrompt.trim() ||
      refinementFrozenUserBubbleText.trim() ||
      prompt.trim();
    if (!t) return "Video";
    return t.length > 56 ? `${t.slice(0, 56)}…` : t;
  }, [lastSubmittedPrompt, refinementFrozenUserBubbleText, prompt]);

  const primaryUserBubbleText =
    lastSubmittedPrompt.trim() ||
    refinementFrozenUserBubbleText.trim() ||
    (submitting ? prompt.trim() : "");

  const userInitials = useMemo(() => {
    const e = user?.email?.trim();
    if (!e) return "?";
    const local = e.split("@")[0] ?? e;
    if (local.length >= 2) return local.slice(0, 2).toUpperCase();
    return local.slice(0, 1).toUpperCase();
  }, [user]);

  const handleSurprisePrompt = useCallback(() => {
    const ideas = [
      "Turn the most emotional beats into punchy vertical clips with bold hooks and captions.",
      "Extract surprising moments, add fast cuts, and optimize for TikTok retention.",
      "Make several Shorts that each open with a pattern interrupt, then deliver one clear takeaway.",
      "Create cinematic trailer-style clips from this footage with punchy on-screen text.",
      "Find standalone mic-drop moments and stack tight captions for Reels.",
    ];
    setPrompt(ideas[Math.floor(Math.random() * ideas.length)]!);
  }, []);

  const scrollVideoHubCarousel = useCallback((dir: -1 | 1) => {
    const el = videoHubCarouselRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 296, behavior: "smooth" });
  }, []);

  const hubHeroOnly =
    !jobId && !lastSubmittedPrompt.trim() && !submitting && !refinementOpen;
  const showPreGenerationHub = hubHeroOnly;

  const firstCompletedVariation = useMemo(
    () => variations.find((v) => !v.error && v.url) ?? null,
    [variations],
  );

  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0A050F] text-white",
        !hideMarketingTitle && "min-h-[520px]",
      )}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-[40%] top-[-18%] h-[520px] w-[900px] rotate-[-13deg] bg-[#180532] opacity-90 blur-[120px]" />
        <div className="absolute -right-[25%] bottom-[-30%] h-[640px] w-[1100px] rotate-[148deg] bg-[#300537] opacity-80 blur-[140px]" />
        <div className="absolute -left-[20%] bottom-[-35%] h-[480px] w-[1400px] rotate-[-57deg] bg-[#230639] opacity-75 blur-[130px]" />
      </div>

      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col font-[family-name:var(--font-instrument-sans)]">
          {omitChromeHeader ? null : (
            <header className="flex h-20 shrink-0 items-center justify-between gap-4 border-b border-white px-4 backdrop-blur-[50px] sm:px-6">
              <h1 className="min-w-0 truncate font-[family-name:var(--font-instrument-serif)] text-2xl font-normal tracking-[0.36px] text-white sm:text-4xl">
                {showPreGenerationHub ? "New Video" : chatTitle}
              </h1>
              <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                {onOpenMobileNav ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="lg:hidden rounded-full text-white hover:bg-white/10"
                    aria-label="Open menu"
                    onClick={() => onOpenMobileNav()}
                  >
                    <Menu className="size-5" />
                  </Button>
                ) : null}
                {showPreGenerationHub ? null : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      className="hidden items-center gap-2 rounded-full border border-transparent bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] px-4 text-white shadow-[0_0_20px_rgba(203,45,206,0.24)] hover:opacity-95 sm:inline-flex"
                      onClick={() => {
                        resetJobUi();
                        setPrompt("");
                        setYoutubeUrl("");
                        setVideoFile(null);
                        if (fileRef.current) fileRef.current.value = "";
                      }}
                    >
                      <Sparkles className="size-5" />
                      New
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="inline-flex items-center gap-2 rounded-full border border-transparent bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] px-3 text-white shadow-[0_0_20px_rgba(203,45,206,0.24)] hover:opacity-95 sm:hidden"
                      onClick={() => {
                        resetJobUi();
                        setPrompt("");
                        setYoutubeUrl("");
                        setVideoFile(null);
                        if (fileRef.current) fileRef.current.value = "";
                      }}
                    >
                      <Sparkles className="size-4" />
                      New
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full border-white/40 bg-transparent text-sm font-medium tracking-wide text-white hover:bg-white/10"
                  onClick={() =>
                    toast.message("Recent generations will live here soon.")
                  }
                >
                  Recent
                </Button>
              </div>
            </header>
          )}
          {omitChromeHeader && !showPreGenerationHub ? (
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4 sm:px-6">
              <p className="min-w-0 truncate text-sm font-medium text-white/80">
                {chatTitle}
              </p>
              <Button
                type="button"
                size="sm"
                className="shrink-0 rounded-full border border-transparent bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] px-3 text-white shadow-[0_0_20px_rgba(203,45,206,0.24)] hover:opacity-95"
                onClick={() => {
                  resetJobUi();
                  setPrompt("");
                  setYoutubeUrl("");
                  setVideoFile(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                <Sparkles className="mr-1 inline size-4" />
                New
              </Button>
            </div>
          ) : null}

          <div
            id="video-output"
            className={cn(
              "min-h-0 flex-1 px-4 py-5 sm:px-10 sm:py-6 lg:px-[clamp(24px,8vw,140px)]",
              showPreGenerationHub
                ? "flex min-h-0 flex-col overflow-hidden"
                : "overflow-y-auto",
            )}
          >
            {!hideMarketingTitle && !showPreGenerationHub ? (
              <p className="mb-6 max-w-2xl text-sm leading-relaxed text-white/70">
                Upload a video or paste YouTube, describe the edit in plain
                English, and get five short-form variations for TikTok and
                Reels. Usually{" "}
                <strong className="text-white/90">2–4 minutes</strong>{" "}
                end-to-end.
              </p>
            ) : null}

            {!user ? (
              <p
                className="mb-6 rounded-2xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white/90"
                role="status"
              >
                Sign in to generate video variations
              </p>
            ) : null}

            {error ? (
              <p className="mb-4 text-sm text-red-300" role="alert">
                {error}
              </p>
            ) : null}

            {showPreGenerationHub ? (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-2 py-4 sm:px-6">
                  <div className="relative flex h-[200px] w-[180px] shrink-0 items-center justify-center">
                    <div
                      className="pointer-events-none absolute inset-0 scale-110 opacity-90 blur-[25px]"
                      aria-hidden
                    >
                      <div className="absolute left-[6%] top-[8%] h-[83%] w-[86%] rounded-full bg-[#3600AA]" />
                      <div className="absolute right-[-20%] top-[-5%] h-[73%] w-[76%] rotate-[60deg] rounded-full bg-[#6800BA]" />
                      <div className="absolute bottom-[-5%] left-[22%] h-[58%] w-[60%] -rotate-[66deg] rounded-full bg-[#A400A7]" />
                    </div>
                    <div className="relative flex size-[120px] items-center justify-center rounded-full bg-white/12 shadow-[0_8px_20px_rgba(0,0,0,0.16)] ring-1 ring-white/10">
                      <Film
                        className="size-14 rotate-[15deg] text-white"
                        strokeWidth={1.25}
                        aria-hidden
                      />
                    </div>
                  </div>
                  <h2
                    className="max-w-3xl px-4 text-center font-[family-name:var(--font-instrument-serif)] text-3xl tracking-[0.36px] text-white sm:text-4xl"
                    style={{ fontWeight: 400 }}
                  >
                    Hi, How can I help you today?
                  </h2>
                </div>

                <div className="relative shrink-0 pb-2">
                  <div
                    className="pointer-events-none absolute inset-y-0 left-0 z-[2] w-12 bg-[linear-gradient(90deg,#21062A_0%,rgba(33,6,42,0)_100%)] sm:w-20"
                    aria-hidden
                  />
                  <div
                    className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-12 bg-[linear-gradient(270deg,#1D0625_0%,rgba(29,6,37,0)_100%)] sm:w-20"
                    aria-hidden
                  />

                  <div
                    ref={videoHubCarouselRef}
                    className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    {VIDEO_HUB_CAROUSEL_CARDS.map(
                      ({ prompt: cardPrompt, thumb }) => (
                        <button
                          key={cardPrompt}
                          type="button"
                          onClick={() => setPrompt(cardPrompt)}
                          className="group relative flex h-[220px] w-[280px] shrink-0 snap-start flex-col justify-end overflow-hidden rounded-2xl p-3 text-left outline outline-1 -outline-offset-1 outline-[rgba(10,5,15,0.16)] transition-transform hover:scale-[1.02]"
                          style={{ background: thumb }}
                        >
                          <div className="pointer-events-none absolute inset-0 bg-black/15 transition-colors group-hover:bg-black/5" />
                          <div className="relative flex items-center gap-2 rounded-xl bg-[rgba(10,5,15,0.16)] px-3 py-2.5 backdrop-blur-[50px]">
                            <p
                              className="min-w-0 flex-1 text-base leading-6 tracking-[0.16px] text-white"
                              style={{ fontWeight: 500 }}
                            >
                              {cardPrompt}
                            </p>
                            <span
                              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-[#0A050F]"
                              aria-hidden
                            >
                              <ArrowRight className="size-4" strokeWidth={2} />
                            </span>
                          </div>
                        </button>
                      ),
                    )}
                  </div>

                  <div className="mt-1 flex justify-between px-2 sm:px-4">
                    <button
                      type="button"
                      className="flex size-6 items-center justify-center text-white/60 transition-colors hover:text-white"
                      aria-label="Scroll suggestions left"
                      onClick={() => scrollVideoHubCarousel(-1)}
                    >
                      <ChevronLeft className="size-6" strokeWidth={1.5} />
                    </button>
                    <button
                      type="button"
                      className="flex size-6 items-center justify-center text-white/60 transition-colors hover:text-white"
                      aria-label="Scroll suggestions right"
                      onClick={() => scrollVideoHubCarousel(1)}
                    >
                      <ChevronRight className="size-6" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {primaryUserBubbleText ? (
                  <div className="mb-6 flex w-full flex-col items-end gap-2">
                    <div className="flex max-w-[min(100%,600px)] items-end gap-3">
                      <div className="min-w-0 rounded-[20px_4px_20px_20px] bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] p-4 shadow-[0_16px_24px_rgba(136,1,220,0.16)] outline outline-1 -outline-offset-1 outline-white/25">
                        <div className="mb-2 flex items-center gap-2 text-sm text-white">
                          <MessageSquare className="size-4 shrink-0 opacity-95" />
                          <span className="tracking-wide">Message</span>
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-5 tracking-wide text-white">
                          {primaryUserBubbleText}
                        </p>
                      </div>
                      <div
                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#CCC1F0] text-xs font-semibold text-[#2d1b4e]"
                        aria-hidden
                      >
                        {userInitials}
                      </div>
                    </div>
                  </div>
                ) : null}

                {refinementOpen && !submitting ? (
                  <div className="mb-8 flex w-full justify-start">
                    <div className="w-full max-w-[min(100%,720px)]">
                      <RefinementChatPanel
                        active={refinementOpen}
                        kind="video_variations"
                        platformIds={VIDEO_REFINEMENT_PLATFORMS}
                        inputSummary={refinementInputSummary}
                        refinementPlanKey={refinementSessionPlanKey}
                        persistenceSessionId={
                          refinementPersistenceSessionId || null
                        }
                        variant="adaKit"
                        embedInChat
                        flatEmbedShell
                        hideChrome={!unifiedClipCoachActive}
                        className="max-h-[min(72vh,640px)]"
                        unifiedClipCoach={unifiedClipCoachActive}
                        refinementActive={refinementOpen && !submitting}
                        conversationalSendRef={
                          unifiedClipCoachActive ? undefined : refinementSendRef
                        }
                        onConversationalBusyChange={
                          unifiedClipCoachActive ? undefined : setRefinementConvBusy
                        }
                        user={user}
                        onDraftContextChange={
                          unifiedClipCoachActive
                            ? handleRefinementDraftForCoach
                            : undefined
                        }
                        clipCoachGenerationContext={
                          unifiedClipCoachActive
                            ? clipCoachGenerationContext
                            : null
                        }
                        clipCoachBriefPrefix={
                          unifiedClipCoachActive ? clipCoachBriefPrefix : ""
                        }
                        onApplyCoachToPrompt={
                          unifiedClipCoachActive
                            ? handleApplyCoachToPrompt
                            : undefined
                        }
                        clipCoachResetNonce={clipCoachResetNonce}
                        onConfirm={(ctx) =>
                          void submitWithRefinementContext(ctx)
                        }
                        onCancel={() => setRefinementOpen(false)}
                      />
                    </div>
                  </div>
                ) : null}

                {submitting && uploadPct > 0 && uploadPct < 99 ? (
                  <div className="mb-4 max-w-md space-y-1">
                    <Progress value={uploadPct}>
                      <div className="flex w-full justify-between text-xs text-white/80">
                        <ProgressLabel>Uploading to app</ProgressLabel>
                        <ProgressValue />
                      </div>
                    </Progress>
                  </div>
                ) : null}
                {submitting && finishingOnServer ? (
                  <div className="mb-4 max-w-md space-y-2">
                    <Progress value={99}>
                      <div className="flex w-full justify-between text-xs text-white/80">
                        <ProgressLabel>Finishing on server</ProgressLabel>
                        <ProgressValue />
                      </div>
                    </Progress>
                    <p className="text-xs text-white/55">
                      Large files upload straight to storage, then the app links
                      the job. That step can take a bit before status updates
                      below.
                    </p>
                  </div>
                ) : null}

                {submitting ||
                (jobId &&
                  jobStatus &&
                  jobStatus !== "complete" &&
                  jobStatus !== "failed") ? (
                  <div className="mb-6 flex w-full justify-center">
                    <div className="inline-flex items-center gap-2 rounded-xl border border-white/60 px-3 py-2 text-sm text-white">
                      <span className="size-4 animate-pulse rounded-full border border-white" />
                      Generating…
                    </div>
                  </div>
                ) : null}

                {user && jobId && jobStatus ? (
                  <div className="mb-8 flex w-full flex-col items-start gap-3">
                    <div className="flex max-w-[min(100%,640px)] items-end gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] shadow-[0_0_20px_rgba(203,45,206,0.24)]">
                        <Film className="size-5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1 rounded-[20px_20px_20px_4px] bg-white/[0.08] p-4 shadow-[0_12px_24px_rgba(11,6,16,0.24)] outline outline-1 -outline-offset-1 outline-white/25">
                        <div className="mb-3 flex items-center gap-2">
                          <span
                            className="size-3.5 rounded-sm bg-[#C717D8]"
                            aria-hidden
                          />
                          <span className="text-sm font-medium tracking-wide text-[#C717D8]">
                            Video
                          </span>
                        </div>

                        {jobStatus === "failed" ? (
                          <p className="text-sm text-red-300">
                            This job failed. Check the toast for details.
                          </p>
                        ) : jobStatus === "complete" &&
                          variations.length > 0 ? (
                          <VariationPreviewRegistryProvider>
                            <div className="space-y-4">
                              <p className="text-sm leading-5 tracking-wide text-white">
                                Here are your short-form cuts — preview each
                                variation, download the ones you like, or open{" "}
                                <span className="text-white/90">Settings</span>{" "}
                                from the composer bar to review defaults.
                              </p>
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {variations.map((v, idx) => {
                                  const num = v.variation_number ?? idx + 1;
                                  const previewInstanceId = `${jobId}-var-${idx}`;
                                  return (
                                    <div
                                      key={
                                        v.url
                                          ? `${v.url}::${num}`
                                          : `${jobId}-var-${idx}-${num}`
                                      }
                                      className="overflow-hidden rounded-lg bg-black/40 ring-1 ring-white/10"
                                    >
                                      <p className="truncate px-2 pt-2 text-xs font-medium text-white/80">
                                        {v.label}
                                        <span className="text-white/50">
                                          {" "}
                                          · Variation {num}
                                        </span>
                                        {v.style_note ? (
                                          <span className="text-white/45">
                                            {" "}
                                            — {v.style_note}
                                          </span>
                                        ) : null}
                                      </p>
                                      <div className="px-0 pb-2 pt-1">
                                        {v.error ? (
                                          <div className="mx-2 flex min-h-[160px] flex-col justify-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-4 text-xs text-red-200">
                                            <p className="font-medium">
                                              This variation failed.
                                            </p>
                                            <p className="wrap-break-word font-mono text-[10px] text-red-100/80">
                                              {v.error}
                                            </p>
                                          </div>
                                        ) : (
                                          <VariationHoverVideo
                                            src={v.url}
                                            instanceId={previewInstanceId}
                                          />
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-3">
                                {firstCompletedVariation ? (
                                  <>
                                    <button
                                      type="button"
                                      className="inline-flex size-9 items-center justify-center rounded-xl text-white hover:bg-white/10"
                                      aria-label="Copy first variation link"
                                      onClick={() => {
                                        void navigator.clipboard.writeText(
                                          firstCompletedVariation.url,
                                        );
                                        toast.success("Link copied");
                                      }}
                                    >
                                      <Copy className="size-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex size-9 items-center justify-center rounded-xl text-white hover:bg-white/10"
                                      aria-label="Share first variation"
                                      onClick={() => {
                                        void navigator.clipboard.writeText(
                                          firstCompletedVariation.url,
                                        );
                                        toast.success(
                                          "Link copied for sharing",
                                        );
                                      }}
                                    >
                                      <Share2 className="size-3.5" />
                                    </button>
                                  </>
                                ) : null}
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    type="button"
                                    className="inline-flex items-center gap-2 rounded-xl px-1 py-1.5 text-sm text-white hover:bg-white/10"
                                  >
                                    <Download className="size-3.5" />
                                    Download
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent
                                    align="start"
                                    className="border-white/10 bg-[#1a1024] text-white"
                                  >
                                    {variations
                                      .filter((v) => !v.error && v.url)
                                      .map((v, idx) => {
                                        const num =
                                          v.variation_number ?? idx + 1;
                                        return (
                                          <DropdownMenuItem
                                            key={`dl-${v.url}-${num}`}
                                            className="cursor-pointer text-white focus:bg-white/10 focus:text-white"
                                            onClick={() => {
                                              const a =
                                                document.createElement("a");
                                              a.href = v.url;
                                              a.target = "_blank";
                                              a.rel = "noreferrer";
                                              a.download = "";
                                              document.body.appendChild(a);
                                              a.click();
                                              a.remove();
                                            }}
                                          >
                                            Variation {num}
                                          </DropdownMenuItem>
                                        );
                                      })}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-2 rounded-xl px-1 py-1.5 text-sm text-white hover:bg-white/10"
                                  onClick={() => {
                                    if (!user) {
                                      onOpenSignIn();
                                      return;
                                    }
                                    resetJobUi({ keepSubmittedPrompt: true });
                                    const regenRoot =
                                      lastSubmittedPrompt.trim() ||
                                      prompt.trim();
                                    setRefinementSessionPlanKey(
                                      buildVideoRefinementSessionPlanKey({
                                        promptSnippet: regenRoot,
                                        videoFile,
                                        youtubeUrl,
                                      }),
                                    );
                                    setRefinementPersistenceSessionId(
                                      crypto.randomUUID(),
                                    );
                                    refinementRootClipInstructionRef.current =
                                      regenRoot;
                                    setRefinementFrozenUserBubbleText(
                                      regenRoot,
                                    );
                                    setPrompt("");
                                    setRefinementOpen(true);
                                  }}
                                >
                                  <RefreshCw className="size-3.5" />
                                  Regenerate
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-2 rounded-xl px-1 py-1.5 text-sm text-white hover:bg-white/10"
                                  onClick={() => setSettingsOpen(true)}
                                >
                                  <SlidersHorizontal className="size-3.5" />
                                  Customize
                                </button>
                              </div>

                              {jobStatus === "complete" && jobPartialNotice ? (
                                <div
                                  className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
                                  role="status"
                                >
                                  <p className="font-medium">
                                    Some variations did not finish
                                  </p>
                                  <p className="mt-1 text-amber-50/90">
                                    {jobPartialNotice}
                                  </p>
                                </div>
                              ) : null}

                              <GenerationFeedbackPanel
                                mode="video"
                                compact
                                videoJobId={jobId}
                                originalPrompt={
                                  lastSubmittedPrompt.trim() ||
                                  refinementFrozenUserBubbleText.trim() ||
                                  prompt.trim()
                                }
                                generationContext={jobGenerationContext}
                                variationsOutput={formatVariationsForFeedback(
                                  variations,
                                )}
                                onCreditsUpdated={setCreditsRemaining}
                                onVideoForked={(newId) => {
                                  stopPoll();
                                  setJobId(newId);
                                  setJobStatus("queued");
                                  setVariations([]);
                                  setJobPartialNotice(null);
                                  setJobGenerationContext(null);
                                  failedToastJobIdRef.current = null;
                                }}
                              />
                            </div>
                          </VariationPreviewRegistryProvider>
                        ) : (
                          <>
                            <div
                              className="mb-4 h-14 w-full max-w-xl overflow-hidden rounded-xl opacity-95 ring-1 ring-white/15"
                              style={{
                                background:
                                  "linear-gradient(118deg, rgba(54,0,170,0.55) 0%, rgba(104,0,186,0.48) 42%, rgba(164,0,167,0.52) 100%)",
                              }}
                              aria-hidden
                            />
                            <p className="mb-3 text-sm text-white/70">
                              {PIPELINE_STEPS.join(" → ")}
                            </p>
                            <div className="max-w-xl space-y-2">
                              <Progress value={pipelineProgressValue}>
                                <div className="flex w-full justify-between text-xs text-white/80">
                                  <ProgressLabel>
                                    {pipelineHeadline}
                                  </ProgressLabel>
                                  <ProgressValue />
                                </div>
                              </Progress>
                            </div>
                            {jobStatus === "queued" && jobAwaitingUploadLink ? (
                              <p
                                className="mt-3 text-sm text-white/60"
                                role="status"
                              >
                                Linking your upload to this job… The worker
                                starts only after the file is attached. If this
                                stays here, check that the finalize step
                                completed (Network tab) or try submitting again.
                              </p>
                            ) : null}
                            <ol className="mt-4 flex flex-wrap gap-x-3 gap-y-2 text-sm text-white/55">
                              {PIPELINE_STEPS.map((label, i) => (
                                <li
                                  key={label}
                                  className={cn(
                                    "flex items-center gap-1.5",
                                    activeStepIndex >= i &&
                                      "font-medium text-white",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "size-2 rounded-full",
                                      activeStepIndex >= i
                                        ? "bg-[#D31CD7]"
                                        : "bg-white/25",
                                    )}
                                  />
                                  {label}
                                </li>
                              ))}
                            </ol>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ) : user ? (
                  <p className="text-sm text-white/55">
                    Describe your edit below to start a new run.
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div
            className={cn(
              "shrink-0 border-t border-white/10 px-4 pb-5 pt-3 sm:px-10 lg:px-[clamp(24px,6vw,100px)]",
            )}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".mp4,.mov,video/mp4,video/quicktime"
              className="sr-only"
              disabled={!user || submitting}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setVideoFile(f);
                if (f) setYoutubeUrl("");
              }}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
              <div className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2 overflow-x-auto rounded-[22px] border border-white/15 bg-white/10 p-1.5 pl-2 outline outline-1 -outline-offset-1 outline-white/15 sm:gap-3">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0 rounded-full border border-white/30 text-white hover:bg-white/10"
                  disabled={!user || submitting}
                  aria-label="Upload video file from device"
                  onClick={() => openVideoFilePicker()}
                >
                  <Paperclip className="size-4" />
                </Button>
                {showPreGenerationHub ? (
                  <input
                    id="video-prompt"
                    type="text"
                    className="min-h-[44px] flex-1 bg-transparent py-2 text-sm leading-5 tracking-[0.14px] text-white outline-none placeholder:text-white/60 disabled:opacity-50"
                    placeholder="Message Ada…"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={!user || submitting}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                  />
                ) : (
                  <textarea
                    id="video-prompt"
                    rows={2}
                    className="max-h-32 min-h-[44px] flex-1 resize-y bg-transparent py-2 text-sm leading-5 tracking-wide text-white outline-none placeholder:text-white/60 disabled:opacity-50"
                    placeholder="Message Ada…"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={!user || submitting}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || e.shiftKey) return;
                      if (refinementOpen && !unifiedClipCoachActive) {
                        e.preventDefault();
                        handleSubmit();
                        return;
                      }
                      if (e.metaKey || e.ctrlKey) {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                  />
                )}
                {embedClipCoach ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={!user || submitting}
                      className={cn(
                        "flex h-9 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium tracking-wide outline-none transition-colors",
                        "border-white/25 bg-white/[0.06] text-white/85 hover:bg-white/10",
                        "focus-visible:ring-2 focus-visible:ring-[#8800DC]/50",
                        "disabled:pointer-events-none disabled:opacity-40",
                        clipCoachEnabled &&
                          "border-[#C717D8]/50 bg-[#C717D8]/15 text-white",
                      )}
                      aria-haspopup="menu"
                      aria-label="Clip coach options"
                    >
                      Coach
                      <ChevronDown className="size-3.5 opacity-80" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="w-56 border-white/10 bg-[#1a1024] p-1 text-white"
                    >
                      <DropdownMenuCheckboxItem
                        checked={clipCoachEnabled}
                        onCheckedChange={(next) => {
                          const on = Boolean(next);
                          setClipCoachEnabled(on);
                          if (!on) setClipCoachResetNonce((n) => n + 1);
                        }}
                        className="text-sm focus:bg-white/10 focus:text-white"
                      >
                        Ada clip coach
                      </DropdownMenuCheckboxItem>
                      <p className="px-2 pb-2 pt-0.5 text-[10px] leading-snug text-white/45">
                        When on, refinement includes a clip strategist thread
                        (uses chat credits). No extra panel in the hub.
                      </p>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5 pr-0.5 sm:gap-2 sm:pr-1">
                  <input
                    ref={youtubeUrlRef}
                    type="text"
                    inputMode="url"
                    autoComplete="url"
                    aria-label="YouTube link"
                    className="h-8 min-w-0 flex-1 rounded-lg border border-white/20 bg-white/5 px-2.5 text-xs text-white outline-none placeholder:text-white/40 focus-visible:ring-2 focus-visible:ring-[#8800DC]/40 sm:max-w-[min(380px,46vw)] sm:flex-none sm:w-[min(380px,46vw)]"
                    placeholder="YouTube link (https://…)"
                    value={youtubeUrl}
                    onChange={(e) => {
                      const v = e.target.value;
                      setYoutubeUrl(v);
                      if (v.trim()) {
                        setVideoFile(null);
                        if (fileRef.current) fileRef.current.value = "";
                      }
                    }}
                    disabled={!user || submitting}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      type="button"
                      disabled={!user}
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-white/30 text-white outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[#8800DC]/50 disabled:pointer-events-none disabled:opacity-40"
                      aria-label="Workspace settings"
                    >
                      <Settings className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="max-h-[min(72dvh,520px)] w-[min(calc(100vw-32px),280px)] overflow-y-auto border-white/10 bg-[#1a1024] p-2 text-white"
                    >
                      <div className="dark">
                        <SettingsRail {...settingsRailProps} />
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0 rounded-full border border-white/30 text-white hover:bg-white/10"
                    aria-label="Voice input (soon)"
                    disabled
                  >
                    <Mic className="size-4 opacity-50" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    className="size-8 shrink-0 rounded-full bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] text-white shadow-[0_0_20px_rgba(203,45,206,0.24)] hover:opacity-95 disabled:opacity-40"
                    aria-label="Send"
                    disabled={
                      !user ||
                      submitting ||
                      (refinementOpen &&
                        !unifiedClipCoachActive &&
                        !refinementMainBarCanSend)
                    }
                    onClick={() => handleSubmit()}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                </div>
              </div>
              {!showPreGenerationHub ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-[52px] shrink-0 rounded-full border-white/40 bg-transparent px-4 text-white hover:bg-white/10 sm:self-auto"
                  onClick={handleSurprisePrompt}
                  disabled={!user || submitting}
                >
                  <Sparkles className="mr-2 size-5" />
                  Surprise me
                </Button>
              ) : null}
            </div>

            {user && hasInput && !refinementOpen ? (
              <details className="mt-3 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-left text-white/90">
                <summary className="cursor-pointer select-none text-xs font-medium text-white/80">
                  Advanced clip options
                </summary>
                <div className="mt-3 space-y-4 pb-1">
                  <div>
                    <p className="mb-2 text-[11px] text-white/50">
                      Start with 3 options for the best balance of speed and choice.
                    </p>
                    <Label className="text-[11px] text-white/60">Variations</Label>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(["1", "2", "3", "5"] as const).map((n) => (
                        <Button
                          key={n}
                          type="button"
                          size="sm"
                          variant={
                            variationPreset === n ? "default" : "outline"
                          }
                          className={
                            variationPreset === n
                              ? "h-8 rounded-full border-0 bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] px-3 text-white"
                              : "h-8 rounded-full border-white/25 bg-transparent px-3 text-white/85 hover:bg-white/10"
                          }
                          onClick={() => setVariationPreset(n)}
                        >
                          {n}
                        </Button>
                      ))}
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          variationPreset === "custom" ? "default" : "outline"
                        }
                        className={
                          variationPreset === "custom"
                            ? "h-8 rounded-full border-0 bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] px-3 text-white"
                            : "h-8 rounded-full border-white/25 bg-transparent px-3 text-white/85 hover:bg-white/10"
                        }
                        onClick={() => setVariationPreset("custom")}
                      >
                        Custom
                      </Button>
                      {variationPreset === "custom" ? (
                        <input
                          type="number"
                          min={1}
                          max={12}
                          aria-label="Custom variation count"
                          className="h-8 w-16 rounded-lg border border-white/20 bg-white/5 px-2 text-center text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-[#8800DC]/40"
                          value={variationCustomStr}
                          onChange={(e) => setVariationCustomStr(e.target.value)}
                        />
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <Label className="text-[11px] text-white/60">
                      Clip length
                    </Label>
                    <p className="mb-2 mt-0.5 text-[11px] text-white/50">
                      Auto length finds the strongest clip naturally. Custom is
                      optional guidance only.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          clipLengthMode === "auto" ? "default" : "outline"
                        }
                        className={
                          clipLengthMode === "auto"
                            ? "h-8 rounded-full border-0 bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] px-3 text-white"
                            : "h-8 rounded-full border-white/25 bg-transparent px-3 text-white/85 hover:bg-white/10"
                        }
                        onClick={() => setClipLengthMode("auto")}
                      >
                        Auto
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          clipLengthMode === "custom" ? "default" : "outline"
                        }
                        className={
                          clipLengthMode === "custom"
                            ? "h-8 rounded-full border-0 bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] px-3 text-white"
                            : "h-8 rounded-full border-white/25 bg-transparent px-3 text-white/85 hover:bg-white/10"
                        }
                        onClick={() => setClipLengthMode("custom")}
                      >
                        Custom
                      </Button>
                    </div>
                    {clipLengthMode === "custom" ? (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <div className="flex flex-col gap-1">
                          <Label className="text-[10px] text-white/45">
                            Min (sec, optional)
                          </Label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            placeholder="—"
                            className="h-8 w-24 rounded-lg border border-white/20 bg-white/5 px-2 text-sm text-white outline-none placeholder:text-white/35 focus-visible:ring-2 focus-visible:ring-[#8800DC]/40"
                            value={minDurationStr}
                            onChange={(e) => setMinDurationStr(e.target.value)}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-[10px] text-white/45">
                            Max (sec, optional)
                          </Label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            placeholder="—"
                            className="h-8 w-24 rounded-lg border border-white/20 bg-white/5 px-2 text-sm text-white outline-none placeholder:text-white/35 focus-visible:ring-2 focus-visible:ring-[#8800DC]/40"
                            value={maxDurationStr}
                            onChange={(e) => setMaxDurationStr(e.target.value)}
                          />
                        </div>
                      </div>
                    ) : null}
                    {clipLengthMode === "custom" ? (
                      <p className="mt-2 text-[11px] text-amber-200/80">
                        Longer clips may take more time to generate.
                      </p>
                    ) : null}
                  </div>
                </div>
              </details>
            ) : null}

            {hasInput ? (
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/55">
                <span>⚡ {VIDEO_JOB_CREDIT_COST} credits</span>
                <span className="text-white/25">·</span>
                <span>~2–5 min</span>
                <span className="text-white/25">·</span>
                <span>
                  {variationPreset === "custom"
                    ? normalizeVariationCount(
                        Number.parseInt(variationCustomStr, 10),
                      )
                    : normalizeVariationCount(
                        Number.parseInt(variationPreset, 10),
                      )}{" "}
                  clip options from your footage
                </span>
              </div>
            ) : null}
            {user && !creditsUnlimited ? (
              <p className="mt-2 text-xs text-amber-200/90">
                This will use <strong>{VIDEO_JOB_CREDIT_COST} credits</strong> (
                {creditsRemaining} remaining). You will confirm before submit.
              </p>
            ) : null}

            <div className="mt-3 flex items-start gap-2 text-xs leading-6 tracking-wide text-white/60">
              <span className="mt-1 inline-block size-3.5 shrink-0 rounded border border-white/50" />
              <span>
                Ada is beta release and may give incorrect or harmful info
              </span>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent
          id="video-settings-dialog"
          showCloseButton
          className="fixed right-auto bottom-0 left-1/2 top-auto max-h-[min(88dvh,640px)] w-full max-w-full translate-x-[-50%] translate-y-0 overflow-y-auto rounded-t-2xl rounded-b-none border-white/15 bg-[#12081c] p-6 text-white sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className="dark">
            <SettingsRail {...settingsRailProps} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
});

VideoVariationWorkspace.displayName = "VideoVariationWorkspace";
