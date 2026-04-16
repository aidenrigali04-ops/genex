"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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
  variations: unknown;
  error_message?: string | null;
  updated_at?: string;
};

const PIPELINE_STEPS = [
  "Queued",
  "Transcribing",
  "Planning",
  "Generating",
  "Done",
] as const;

async function postVideoJobUrlJson(params: {
  prompt: string;
  youtubeUrl: string;
}): Promise<{ id: string; remainingCredits?: number }> {
  const res = await fetch("/api/video-jobs", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputType: "url",
      prompt: params.prompt,
      youtubeUrl: params.youtubeUrl,
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

function parseVariations(raw: unknown): VideoVariationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is VideoVariationItem => {
    if (typeof x !== "object" || x === null || !("url" in x)) return false;
    const u = (x as VideoVariationItem).url;
    return typeof u === "string" && u.length > 0;
  });
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
  const [jobUpdatedAt, setJobUpdatedAt] = useState<string | null>(null);
  const [variations, setVariations] = useState<VideoVariationItem[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failedToastJobIdRef = useRef<string | null>(null);
  /** Re-render while queued so “stale” detection can flip without waiting on poll payload changes. */
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    if (jobStatus !== "queued" || !jobId) return;
    const t = setInterval(() => setNowTick(Date.now()), 4000);
    return () => clearInterval(t);
  }, [jobStatus, jobId]);

  const staleQueued =
    jobStatus === "queued" &&
    jobUpdatedAt != null &&
    nowTick - new Date(jobUpdatedAt).getTime() > 12_000;

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const fetchJob = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/video-jobs/${id}`, { credentials: "same-origin" });
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
      setJobUpdatedAt(
        typeof row.updated_at === "string" ? row.updated_at : null,
      );
      setVariations(parseVariations(row.variations));

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
    setJobUpdatedAt(null);
    setVariations([]);
    setUploadPct(0);
    failedToastJobIdRef.current = null;
  };

  const handleSubmit = async () => {
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

    const creditNote = creditsUnlimited
      ? "Unlimited credits are enabled."
      : `This will use ${VIDEO_JOB_CREDIT_COST} credits (${creditsRemaining} remaining).`;
    const ok = window.confirm(
      `Generate 5 variations?\n\n${creditNote}\n\nUsually 2–4 minutes once processing starts.`,
    );
    if (!ok) return;

    setSubmitting(true);
    setUploadPct(0);
    setFinishingOnServer(false);
    resetJobUi();

    try {
      const { id, remainingCredits } =
        sourceMode === "upload" && videoFile
          ? await submitUploadJobViaDirectStorage({
              file: videoFile,
              prompt: prompt.trim(),
              onProgress: setUploadPct,
              onUploadFullySent: () => setFinishingOnServer(true),
            })
          : await postVideoJobUrlJson({
              prompt: prompt.trim(),
              youtubeUrl: youtubeUrl.trim(),
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
            onClick={() => void handleSubmit()}
          >
            {submitting ? "Working…" : "Generate 5 variations"}
          </Button>
        </section>

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
                  {staleQueued ? (
                    <div
                      className="max-w-2xl rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100"
                      role="status"
                    >
                      <p className="font-medium">Still queued — the worker may be down, wrong Supabase project, or using the anon key instead of service_role.</p>
                      <p className="mt-2 text-amber-900/90 dark:text-amber-50/90">
                        Jobs only move past <strong>Queued</strong> when{" "}
                        <code className="rounded bg-black/10 px-1 py-0.5 text-xs dark:bg-white/10">
                          worker/worker.js
                        </code>{" "}
                        is running (ffmpeg, yt-dlp on PATH, OpenAI). From the repo root:{" "}
                        <code className="rounded bg-black/10 px-1 py-0.5 text-xs dark:bg-white/10">
                          {"cd worker && npm install && npm start"}
                        </code>
                        , or{" "}
                        <code className="rounded bg-black/10 px-1 py-0.5 text-xs dark:bg-white/10">
                          npm run worker
                        </code>{" "}
                        from the app root after{" "}
                        <code className="rounded bg-black/10 px-1 py-0.5 text-xs dark:bg-white/10">
                          cd worker && npm install
                        </code>
                        . Use{" "}
                        <code className="rounded bg-black/10 px-1 py-0.5 text-xs dark:bg-white/10">
                          SUPABASE_SERVICE_ROLE_KEY
                        </code>{" "}
                        and the same project URL as the app (
                        <code className="rounded bg-black/10 px-1 py-0.5 text-xs dark:bg-white/10">
                          SUPABASE_URL
                        </code>{" "}
                        or{" "}
                        <code className="rounded bg-black/10 px-1 py-0.5 text-xs dark:bg-white/10">
                          NEXT_PUBLIC_SUPABASE_URL
                        </code>
                        ).
                      </p>
                    </div>
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
                      return (
                        <Card key={`${v.label}-${num}`} className="overflow-hidden">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-base">{v.label}</CardTitle>
                            <CardDescription>
                              Variation {num}
                              {v.style_note ? ` — ${v.style_note}` : ""}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-2 px-0">
                            <video
                              className="aspect-9/16 max-h-[min(560px,70vh)] w-full bg-black object-cover"
                              src={v.url}
                              autoPlay
                              muted
                              loop
                              playsInline
                              controls
                            />
                          </CardContent>
                          <CardFooter className="flex flex-wrap gap-2">
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
                          </CardFooter>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
      </>
    </div>
  );
}
