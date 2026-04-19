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
import { RatingWidget } from "@/components/rating-widget";
import { LazyVideoPlayer } from "@/components/lazy-video-player";
import { SettingsRail } from "@/components/genex/settings-rail";
import { RefinementChatDialog } from "@/components/refinement-chat-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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

import type { VideoVariationItem, VideoJobStatus } from "@/lib/video-job-types";
import { VIDEO_JOB_CREDIT_COST } from "@/lib/video-job-cost";
import type { GenerationContextV1 } from "@/lib/generation-context";
import { isGenerationContextV1 } from "@/lib/generation-context";
import type { PlatformId } from "@/lib/platforms";
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
        const j = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        if (j.message) msg = j.message;
        else if (j.error) msg = j.error;
      } catch {
        if (xhr.responseText) msg = xhr.responseText.slice(0, 500);
      }
      reject(new Error(msg || "Storage upload failed."));
    };
    xhr.onerror = () => reject(new Error("Network error during upload to storage."));
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
      String(prep.message || prep.error || prepRes.statusText || "Could not start upload."),
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
      const err = typeof v.error === "string" && v.error ? `Error: ${v.error}` : "";
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

function VariationPreviewRegistryProvider({ children }: { children: ReactNode }) {
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
function VariationHoverVideo({ src, instanceId }: { src: string; instanceId: string }) {
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
        if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
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
  } = props;
  const [sourceMode, setSourceMode] = useState<"upload" | "url">("upload");
  const [prompt, setPrompt] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const youtubeUrlRef = useRef<HTMLInputElement>(null);
  const videoHubCarouselRef = useRef<HTMLDivElement>(null);

  const openVideoFilePicker = useCallback(() => {
    setSourceMode("upload");
    window.setTimeout(() => fileRef.current?.click(), 0);
  }, []);

  const selectYoutubeUrlSource = useCallback(() => {
    setSourceMode("url");
    window.setTimeout(() => youtubeUrlRef.current?.focus(), 0);
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
  const [jobGenerationContext, setJobGenerationContext] =
    useState<GenerationContextV1 | null>(null);
  const [lastSubmittedPrompt, setLastSubmittedPrompt] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failedToastJobIdRef = useRef<string | null>(null);
  /** Parent often passes an inline callback; keep stable so polling `useEffect` does not reset every render. */
  const onJobFinishedRef = useRef(onJobFinished);
  useEffect(() => {
    onJobFinishedRef.current = onJobFinished;
  }, [onJobFinished]);
  /** True while a direct-upload job is queued but `storage_path` is not linked yet (worker cannot claim). */
  const [jobAwaitingUploadLink, setJobAwaitingUploadLink] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const fetchJob = useCallback(
    async (id: string) => {
      const fetchOnce = async (slim: boolean) => {
        const url = `/api/video-jobs/${id}${slim ? "?slim=true" : ""}`;
        return fetch(url, {
          credentials: "same-origin",
          cache: "no-store",
        });
      };

      const readErrorMessage = async (res: Response) => {
        const raw = await res.text();
        let msg = raw || res.statusText;
        try {
          const j = JSON.parse(raw) as { error?: string; message?: string };
          if (j.message) msg = j.message;
          else if (j.error) msg = j.error;
        } catch {
          /* keep */
        }
        return msg;
      };

      let res = await fetchOnce(true);
      if (!res.ok) {
        setError(`Could not load job (${res.status}): ${await readErrorMessage(res)}`);
        return;
      }
      setError(null);
      let row = (await res.json()) as JobRow;

      if (row.status === "complete") {
        res = await fetchOnce(false);
        if (!res.ok) {
          setError(
            `Could not load job (${res.status}): ${await readErrorMessage(res)}`,
          );
          return;
        }
        row = (await res.json()) as JobRow;
      }
      setJobStatus(row.status);
      const awaitingLink =
        row.status === "queued" &&
        row.input_type === "upload" &&
        !(typeof row.storage_path === "string" && row.storage_path.trim()) &&
        !!(typeof row.pending_storage_path === "string" && row.pending_storage_path.trim());
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
    },
    [],
  );

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
  };

  const handleSubmit = () => {
    setError(null);
    if (!user) {
      onOpenSignIn();
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
    if (sourceMode === "upload" && !videoFile) {
      setError("Choose a video file (MP4 or MOV).");
      return;
    }
    if (sourceMode === "url" && !youtubeUrl.trim()) {
      setError("Paste a YouTube URL.");
      return;
    }

    setRefinementOpen(true);
  };

  const hasInput = useMemo(() => {
    if (sourceMode === "upload") return videoFile != null;
    const trimmed = youtubeUrl.trim();
    if (!trimmed) return false;
    try {
      const u = new URL(trimmed);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, [sourceMode, videoFile, youtubeUrl]);

  const submitWithRefinementContext = async (ctx: GenerationContextV1) => {
    setRefinementOpen(false);
    setSubmitting(true);
    setUploadPct(0);
    setFinishingOnServer(false);
    resetJobUi();
    setLastSubmittedPrompt(prompt.trim());
    setJobGenerationContext(ctx);

    try {
      const { id, remainingCredits } =
        sourceMode === "upload" && videoFile
          ? await submitUploadJobViaDirectStorage({
              file: videoFile,
              prompt: prompt.trim(),
              generationContext: ctx,
              onProgress: setUploadPct,
              onUploadFullySent: () => setFinishingOnServer(true),
            })
          : await postVideoJobUrlJson({
              prompt: prompt.trim(),
              youtubeUrl: youtubeUrl.trim(),
              generationContext: ctx,
            });
      if (typeof remainingCredits === "number") {
        setCreditsRemaining(remainingCredits);
      }
      setJobId(id);
      setJobStatus("queued");
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
    jobStatus && jobStatus !== "failed"
      ? statusToStep(jobStatus)
      : -1;

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
    const t = lastSubmittedPrompt.trim() || prompt.trim();
    if (!t) return "Video";
    return t.length > 56 ? `${t.slice(0, 56)}…` : t;
  }, [lastSubmittedPrompt, prompt]);

  const userInitials = useMemo(() => {
    const e = user?.email?.trim();
    if (!e) return "?";
    const local = e.split("@")[0] ?? e;
    if (local.length >= 2) return local.slice(0, 2).toUpperCase();
    return local.slice(0, 1).toUpperCase();
  }, [user]);

  const handleSurprisePrompt = useCallback(() => {
    const ideas = [
      "Turn the most emotional beats into 5 vertical clips with bold hooks and captions.",
      "Extract surprising moments, add fast cuts, and optimize for TikTok retention.",
      "Make five Shorts that each open with a pattern interrupt, then deliver one clear takeaway.",
      "Create cinematic trailer-style clips from this footage with punchy on-screen text.",
      "Find five standalone mic-drop moments and stack tight captions for Reels.",
    ];
    setPrompt(ideas[Math.floor(Math.random() * ideas.length)]!);
  }, []);

  const scrollVideoHubCarousel = useCallback((dir: -1 | 1) => {
    const el = videoHubCarouselRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 296, behavior: "smooth" });
  }, []);

  const showPreGenerationHub =
    !jobId && !lastSubmittedPrompt.trim() && !submitting;

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

      <div className="relative z-[1] flex min-h-0 flex-1 flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col font-[family-name:var(--font-instrument-sans)]">
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
                onClick={() => toast.message("Recent generations will live here soon.")}
              >
                Recent
              </Button>
            </div>
          </header>

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
                Upload a video or paste YouTube, describe the edit in plain English, and get five
                short-form variations for TikTok and Reels. Usually{" "}
                <strong className="text-white/90">2–4 minutes</strong> end-to-end.
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
                    {VIDEO_HUB_CAROUSEL_CARDS.map(({ prompt: cardPrompt, thumb }) => (
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
                    ))}
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
            {lastSubmittedPrompt.trim() ? (
              <div className="mb-6 flex w-full flex-col items-end gap-2">
                <div className="flex max-w-[min(100%,600px)] items-end gap-3">
                  <div className="min-w-0 rounded-[20px_4px_20px_20px] bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] p-4 shadow-[0_16px_24px_rgba(136,1,220,0.16)] outline outline-1 -outline-offset-1 outline-white/25">
                    <div className="mb-2 flex items-center gap-2 text-sm text-white">
                      <MessageSquare className="size-4 shrink-0 opacity-95" />
                      <span className="tracking-wide">Message</span>
                    </div>
                    <p className="text-sm leading-5 tracking-wide text-white">{lastSubmittedPrompt}</p>
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
                  Large files upload straight to storage, then the app links the job. That step can
                  take a bit before status updates below.
                </p>
              </div>
            ) : null}

            {(submitting ||
              (jobId &&
                jobStatus &&
                jobStatus !== "complete" &&
                jobStatus !== "failed")) ? (
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
                      <span className="size-3.5 rounded-sm bg-[#C717D8]" aria-hidden />
                      <span className="text-sm font-medium tracking-wide text-[#C717D8]">Video</span>
                    </div>

                    {jobStatus === "failed" ? (
                      <p className="text-sm text-red-300">
                        This job failed. Check the toast for details.
                      </p>
                    ) : jobStatus === "complete" && variations.length > 0 ? (
                      <VariationPreviewRegistryProvider>
                        <div className="space-y-4">
                          <p className="text-sm leading-5 tracking-wide text-white">
                            Here are your short-form cuts — preview each variation, download the
                            ones you like, or open{" "}
                            <span className="text-white/90">Settings</span> from the composer bar
                            to review defaults.
                          </p>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {variations.map((v, idx) => {
                              const num = v.variation_number ?? idx + 1;
                              const previewInstanceId = `${jobId}-var-${idx}`;
                              return (
                                <div
                                  key={v.url ? `${v.url}::${num}` : `${jobId}-var-${idx}-${num}`}
                                  className="overflow-hidden rounded-lg bg-black/40 ring-1 ring-white/10"
                                >
                                  <p className="truncate px-2 pt-2 text-xs font-medium text-white/80">
                                    {v.label}
                                    <span className="text-white/50"> · Variation {num}</span>
                                    {v.style_note ? (
                                      <span className="text-white/45"> — {v.style_note}</span>
                                    ) : null}
                                  </p>
                                  <div className="px-0 pb-2 pt-1">
                                    {v.error ? (
                                      <div className="mx-2 flex min-h-[160px] flex-col justify-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-4 text-xs text-red-200">
                                        <p className="font-medium">This variation failed.</p>
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
                                    void navigator.clipboard.writeText(firstCompletedVariation.url);
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
                                    void navigator.clipboard.writeText(firstCompletedVariation.url);
                                    toast.success("Link copied for sharing");
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
                                    const num = v.variation_number ?? idx + 1;
                                    return (
                                      <DropdownMenuItem
                                        key={`dl-${v.url}-${num}`}
                                        className="cursor-pointer text-white focus:bg-white/10 focus:text-white"
                                        onClick={() => {
                                          const a = document.createElement("a");
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
                              <p className="font-medium">Some variations did not finish</p>
                              <p className="mt-1 text-amber-50/90">{jobPartialNotice}</p>
                            </div>
                          ) : null}

                          {jobId ? (
                            <div className="rounded-xl bg-black/50 px-4 py-3 ring-1 ring-white/10">
                              <RatingWidget kind="video" jobId={jobId} />
                            </div>
                          ) : null}
                          <GenerationFeedbackPanel
                            mode="video"
                            videoJobId={jobId}
                            originalPrompt={prompt}
                            generationContext={jobGenerationContext}
                            variationsOutput={formatVariationsForFeedback(variations)}
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
                        <p className="mb-3 text-sm text-white/70">{PIPELINE_STEPS.join(" → ")}</p>
                        <div className="max-w-xl space-y-2">
                          <Progress value={pipelineProgressValue}>
                            <div className="flex w-full justify-between text-xs text-white/80">
                              <ProgressLabel>{pipelineHeadline}</ProgressLabel>
                              <ProgressValue />
                            </div>
                          </Progress>
                        </div>
                        {jobStatus === "queued" && jobAwaitingUploadLink ? (
                          <p className="mt-3 text-sm text-white/60" role="status">
                            Linking your upload to this job… The worker starts only after the file is
                            attached. If this stays here, check that the finalize step completed
                            (Network tab) or try submitting again.
                          </p>
                        ) : null}
                        <ol className="mt-4 flex flex-wrap gap-x-3 gap-y-2 text-sm text-white/55">
                          {PIPELINE_STEPS.map((label, i) => (
                            <li
                              key={label}
                              className={cn(
                                "flex items-center gap-1.5",
                                activeStepIndex >= i && "font-medium text-white",
                              )}
                            >
                              <span
                                className={cn(
                                  "size-2 rounded-full",
                                  activeStepIndex >= i ? "bg-[#D31CD7]" : "bg-white/25",
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
              <p className="text-sm text-white/55">Describe your edit below to start a new run.</p>
            ) : null}
              </>
            )}
          </div>

          <div className="shrink-0 border-t border-white/10 px-4 pb-5 pt-3 sm:px-10 lg:px-[clamp(24px,6vw,100px)]">
            <input
              ref={fileRef}
              type="file"
              accept=".mp4,.mov,video/mp4,video/quicktime"
              className="sr-only"
              disabled={!user || submitting}
              onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
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
                      if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                  />
                )}
                <div className="ml-auto flex shrink-0 items-center gap-1 pr-0.5 sm:gap-1.5 sm:pr-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      type="button"
                      disabled={!user || submitting}
                      className={cn(
                        "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-white/25 px-2 text-[11px] font-medium text-white outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[#8800DC]/50 disabled:pointer-events-none disabled:opacity-40 sm:px-2.5 sm:text-xs",
                        sourceMode === "upload" && "border-white/40 bg-white/15",
                        sourceMode === "url" && "border-white/40 bg-white/15",
                      )}
                      aria-label="Choose video source"
                    >
                      {sourceMode === "upload" ? "Upload" : "YouTube"}
                      <ChevronDown className="size-3.5 opacity-80" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="min-w-[200px] border-white/10 bg-[#1a1024] text-white"
                    >
                      <DropdownMenuLabel className="text-xs text-white/55">
                        Video source
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        className="cursor-pointer text-white focus:bg-white/10 focus:text-white"
                        onClick={() => openVideoFilePicker()}
                      >
                        Upload from device…
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="cursor-pointer text-white focus:bg-white/10 focus:text-white"
                        onClick={() => selectYoutubeUrlSource()}
                      >
                        Paste YouTube URL…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {sourceMode === "url" ? (
                    <input
                      ref={youtubeUrlRef}
                      type="url"
                      aria-label="YouTube URL"
                      className="h-8 w-[min(200px,32vw)] shrink-0 rounded-lg border border-white/20 bg-white/5 px-2 text-xs text-white outline-none placeholder:text-white/40 focus-visible:ring-2 focus-visible:ring-[#8800DC]/40 sm:w-[min(260px,28vw)]"
                      placeholder="youtube.com/…"
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      disabled={!user || submitting}
                    />
                  ) : (
                    <span
                      className="max-w-[72px] shrink-0 truncate text-[10px] text-white/45 sm:max-w-[100px] sm:text-[11px] md:max-w-[140px]"
                      title={videoFile?.name ?? undefined}
                    >
                      {videoFile?.name ?? "No file yet"}
                    </span>
                  )}
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
                    disabled={!user || submitting}
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

            {hasInput ? (
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/55">
                <span>⚡ {VIDEO_JOB_CREDIT_COST} credits</span>
                <span className="text-white/25">·</span>
                <span>~2–5 min</span>
                <span className="text-white/25">·</span>
                <span>5 variations from your footage</span>
              </div>
            ) : null}
            {user && !creditsUnlimited ? (
              <p className="mt-2 text-xs text-amber-200/90">
                This will use <strong>{VIDEO_JOB_CREDIT_COST} credits</strong> ({creditsRemaining}{" "}
                remaining). You will confirm before submit.
              </p>
            ) : null}

            <div className="mt-3 flex items-start gap-2 text-xs leading-6 tracking-wide text-white/60">
              <span className="mt-1 inline-block size-3.5 shrink-0 rounded border border-white/50" />
              <span>Ada is beta release and may give incorrect or harmful info</span>
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

      <RefinementChatDialog
        open={refinementOpen}
        onOpenChange={setRefinementOpen}
        kind="video_variations"
        platformIds={VIDEO_REFINEMENT_PLATFORMS}
        inputSummary={
          sourceMode === "upload"
            ? videoFile
              ? `Upload: ${videoFile.name}`
              : "Video upload"
            : `YouTube: ${youtubeUrl.trim() || "…"}`
        }
        onConfirm={(ctx) => void submitWithRefinementContext(ctx)}
      />
    </div>
  );
});

VideoVariationWorkspace.displayName = "VideoVariationWorkspace";
