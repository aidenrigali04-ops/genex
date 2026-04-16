"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { GenerationFeedbackPanel } from "@/components/generation-feedback-panel";
import { RefinementChatDialog } from "@/components/refinement-chat-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
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
};

type JobRow = {
  id: string;
  status: VideoJobStatus;
  input_type?: string;
  storage_path?: string | null;
  pending_storage_path?: string | null;
  variations: unknown;
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
  }, [src]);

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
      <video
        ref={ref}
        src={src}
        poster={posterUrl ?? undefined}
        crossOrigin="anonymous"
        className="aspect-9/16 max-h-[min(560px,70vh)] w-full transform-gpu bg-black object-cover"
        muted
        playsInline
        loop
        controls
        preload="metadata"
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

export function VideoVariationWorkspace({
  user,
  creditsRemaining,
  creditsUnlimited,
  setCreditsRemaining,
  onOpenBuy,
  onOpenSignIn,
  onJobFinished,
}: Props) {
  const [sourceMode, setSourceMode] = useState<"upload" | "url">("upload");
  const [prompt, setPrompt] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failedToastJobIdRef = useRef<string | null>(null);
  /** True while a direct-upload job is queued but `storage_path` is not linked yet (worker cannot claim). */
  const [jobAwaitingUploadLink, setJobAwaitingUploadLink] = useState(false);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const fetchJob = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/video-jobs/${id}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        const raw = await res.text();
        let msg = raw || res.statusText;
        try {
          const j = JSON.parse(raw) as { error?: string; message?: string };
          if (j.message) msg = j.message;
          else if (j.error) msg = j.error;
        } catch {
          /* keep */
        }
        setError(`Could not load job (${res.status}): ${msg}`);
        return;
      }
      setError(null);
      const row = (await res.json()) as JobRow;
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
        onJobFinished();
      }
    },
    [onJobFinished],
  );

  useEffect(() => {
    if (!jobId) return;
    void fetchJob(jobId);
    pollRef.current = setInterval(() => void fetchJob(jobId), 3000);
    return stopPoll;
  }, [jobId, fetchJob]);

  const resetJobUi = () => {
    stopPoll();
    setJobId(null);
    setJobStatus(null);
    setVariations([]);
    setJobPartialNotice(null);
    setJobGenerationContext(null);
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

  const submitWithRefinementContext = async (ctx: GenerationContextV1) => {
    setRefinementOpen(false);
    setSubmitting(true);
    setUploadPct(0);
    setFinishingOnServer(false);
    resetJobUi();
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

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Video-first AI editor
        </h1>
        <p className="text-muted-foreground max-w-2xl text-base sm:text-lg">
          Upload a video or paste YouTube, describe the edit in plain English,
          and get five short-form variations for TikTok and Reels.
        </p>
        <p className="text-muted-foreground text-sm">
          Usually <strong>2–4 minutes</strong> end-to-end.
        </p>
      </section>

      <>
        <section className="space-y-6">
          {!user ? (
            <p className="bg-muted/40 text-foreground rounded-xl border border-border px-4 py-3 text-sm font-medium">
              Sign in to generate video variations
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={sourceMode === "upload" ? "default" : "outline"}
              onClick={() => setSourceMode("upload")}
              disabled={!user || submitting}
            >
              Upload video
            </Button>
            <Button
              type="button"
              size="sm"
              variant={sourceMode === "url" ? "default" : "outline"}
              onClick={() => setSourceMode("url")}
              disabled={!user || submitting}
            >
              YouTube URL
            </Button>
          </div>

          {sourceMode === "upload" ? (
            <div className="space-y-2">
              <Label>Video file (MP4 or MOV — max 500 MB)</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".mp4,.mov,video/mp4,video/quicktime"
                className="sr-only"
                disabled={!user || submitting}
                onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!user || submitting}
                  onClick={() => fileRef.current?.click()}
                >
                  Choose file
                </Button>
                <span className="text-muted-foreground text-sm">
                  {videoFile?.name ?? "No file selected"}
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="yt-url">YouTube URL</Label>
              <input
                id="yt-url"
                type="url"
                className="border-input bg-background ring-ring/50 focus-visible:ring-[3px] h-12 w-full max-w-xl rounded-xl border px-4 text-base outline-none disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="https://www.youtube.com/watch?v=…"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                disabled={!user || submitting}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="video-prompt">What do you want?</Label>
            <textarea
              id="video-prompt"
              className="border-input bg-background ring-ring/50 focus-visible:ring-[3px] min-h-[160px] w-full max-w-3xl resize-y rounded-xl border px-4 py-3 text-base outline-none disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Describe what you want: e.g. 'Grab the 5 most climactic moments from this vlog and create short clips I can post on TikTok to promote my YouTube'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={!user || submitting}
            />
          </div>

          {user && !creditsUnlimited ? (
            <p className="text-amber-600/90 text-sm dark:text-amber-400/90">
              This will use <strong>{VIDEO_JOB_CREDIT_COST} credits</strong>{" "}
              ({creditsRemaining} remaining). You will confirm before submit.
            </p>
          ) : null}

          {submitting && uploadPct > 0 && uploadPct < 99 ? (
            <div className="max-w-md space-y-1">
              <Progress value={uploadPct}>
                <div className="flex w-full justify-between text-xs">
                  <ProgressLabel>Uploading to app</ProgressLabel>
                  <ProgressValue />
                </div>
              </Progress>
            </div>
          ) : null}
          {submitting && finishingOnServer ? (
            <div className="max-w-md space-y-2">
              <Progress value={99}>
                <div className="flex w-full justify-between text-xs">
                  <ProgressLabel>Finishing on server</ProgressLabel>
                  <ProgressValue />
                </div>
              </Progress>
              <p className="text-muted-foreground text-xs">
                Large files upload straight to storage, then the app links the job. That step
                can take a bit before status updates below.
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <Button
            type="button"
            size="lg"
            className="w-full max-w-md sm:w-auto"
            disabled={submitting}
            onClick={() => handleSubmit()}
          >
            {submitting ? "Working…" : "Generate 5 variations"}
          </Button>
        </section>

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

        {user && jobId && jobStatus ? (
            <section className="border-border space-y-4 border-t pt-10">
              <h2 className="text-xl font-semibold">Status</h2>

              {jobStatus !== "failed" ? (
                <>
                  <p className="text-muted-foreground text-sm">
                    {PIPELINE_STEPS.join(" → ")}
                  </p>
                  <div className="max-w-xl space-y-2">
                    <Progress value={pipelineProgressValue}>
                      <div className="flex w-full justify-between text-xs">
                        <ProgressLabel>{pipelineHeadline}</ProgressLabel>
                        <ProgressValue />
                      </div>
                    </Progress>
                  </div>
                  {jobStatus === "complete" && jobPartialNotice ? (
                    <div
                      className="max-w-2xl rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100"
                      role="status"
                    >
                      <p className="font-medium">Some variations did not finish</p>
                      <p className="mt-1 text-amber-900/90 dark:text-amber-50/90">
                        {jobPartialNotice}
                      </p>
                    </div>
                  ) : null}
                  {jobStatus === "queued" && jobAwaitingUploadLink ? (
                    <p className="text-muted-foreground max-w-2xl text-sm" role="status">
                      Linking your upload to this job… The worker starts only after the file is
                      attached. If this stays here, check that the finalize step completed (Network
                      tab) or try submitting again.
                    </p>
                  ) : null}
                  <ol className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-2 text-sm">
                    {PIPELINE_STEPS.map((label, i) => (
                      <li
                        key={label}
                        className={cn(
                          "flex items-center gap-1.5",
                          activeStepIndex >= i && "text-foreground font-medium",
                        )}
                      >
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            activeStepIndex >= i
                              ? "bg-primary"
                              : "bg-muted-foreground/30",
                          )}
                        />
                        {label}
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="text-destructive text-sm">
                  This job failed. Check the toast for details.
                </p>
              )}

              {variations.length > 0 && jobStatus === "complete" ? (
                <VariationPreviewRegistryProvider>
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-lg font-semibold">Your variations</h3>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          resetJobUi();
                          setPrompt("");
                          setYoutubeUrl("");
                          setVideoFile(null);
                          if (fileRef.current) fileRef.current.value = "";
                        }}
                      >
                        Regenerate with different style
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {variations.map((v, idx) => {
                        const num = v.variation_number ?? idx + 1;
                        const previewInstanceId = `${jobId}-var-${idx}`;
                        return (
                          <Card
                            key={v.url ? `${v.url}::${num}` : `${jobId}-var-${idx}-${num}`}
                            className="overflow-hidden"
                          >
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base">{v.label}</CardTitle>
                              <CardDescription>
                                Variation {num}
                                {v.style_note ? ` — ${v.style_note}` : ""}
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2 px-0">
                              {v.error ? (
                                <div className="bg-destructive/10 text-destructive flex min-h-[200px] flex-col justify-center gap-2 rounded-lg border border-destructive/30 px-4 py-6 text-sm">
                                  <p className="font-medium">This variation failed to render.</p>
                                  <p className="text-muted-foreground font-mono text-xs wrap-break-word">
                                    {v.error}
                                  </p>
                                </div>
                              ) : (
                                <VariationHoverVideo
                                  src={v.url}
                                  instanceId={previewInstanceId}
                                />
                              )}
                            </CardContent>
                            <CardFooter className="flex flex-wrap gap-2">
                              {!v.error ? (
                                <>
                                  <a
                                    href={v.url}
                                    download
                                    target="_blank"
                                    rel="noreferrer"
                                    className={cn(
                                      buttonVariants({ variant: "secondary", size: "sm" }),
                                      "inline-flex",
                                    )}
                                  >
                                    Download
                                  </a>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      void navigator.clipboard.writeText(v.url);
                                      toast.success("Link copied");
                                    }}
                                  >
                                    Copy link
                                  </Button>
                                </>
                              ) : null}
                            </CardFooter>
                          </Card>
                        );
                      })}
                    </div>
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
              ) : null}
            </section>
          ) : null}
      </>
    </div>
  );
}
