"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  variations: VideoVariationItem[] | null;
};

function postVideoJobMultipart(
  form: FormData,
  onProgress: (pct: number) => void,
): Promise<{ id: string; remainingCredits?: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/video-jobs");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.min(99, Math.round((100 * e.loaded) / e.total)));
      }
    };
    xhr.onload = () => {
      const res =
        typeof xhr.response === "object" && xhr.response
          ? (xhr.response as {
              id?: string;
              remainingCredits?: number;
              error?: string;
              message?: string;
            })
          : {};
      if (xhr.status >= 200 && xhr.status < 300 && res.id) {
        onProgress(100);
        resolve({ id: res.id, remainingCredits: res.remainingCredits });
        return;
      }
      const msg =
        res.message ||
        res.error ||
        (xhr.status === 403 ? "no_credits" : xhr.statusText);
      reject(new Error(String(msg)));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(form);
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<VideoJobStatus | null>(null);
  const [variations, setVariations] = useState<VideoVariationItem[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const fetchJob = useCallback(async (id: string) => {
    const res = await fetch(`/api/video-jobs/${id}`, { credentials: "same-origin" });
    if (!res.ok) return;
    const row = (await res.json()) as JobRow;
    setJobStatus(row.status);
    const raw = row.variations;
    const list: VideoVariationItem[] = Array.isArray(raw)
      ? raw.filter(
          (x): x is VideoVariationItem =>
            typeof x === "object" &&
            x !== null &&
            "url" in x &&
            typeof (x as VideoVariationItem).url === "string",
        )
      : [];
    setVariations(list);
    if (row.status === "complete" || row.status === "failed") {
      stopPoll();
      if (row.status === "complete") onJobFinished();
    }
  }, [onJobFinished]);

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
    setUploadPct(0);
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
      setError("Choose a video file (MP4, MOV, or WebM).");
      return;
    }
    if (sourceMode === "url" && !youtubeUrl.trim()) {
      setError("Paste a YouTube URL.");
      return;
    }

    setSubmitting(true);
    setUploadPct(0);
    resetJobUi();

    const fd = new FormData();
    fd.append("prompt", prompt.trim());
    fd.append("inputType", sourceMode);
    if (sourceMode === "upload" && videoFile) fd.append("file", videoFile);
    if (sourceMode === "url") fd.append("youtubeUrl", youtubeUrl.trim());

    try {
      const { id, remainingCredits } = await postVideoJobMultipart(fd, setUploadPct);
      if (typeof remainingCredits === "number") {
        setCreditsRemaining(remainingCredits);
      }
      setJobId(id);
      setJobStatus("queued");
      const pr = await fetch(`/api/video-jobs/${id}/process`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!pr.ok) {
        const j = (await pr.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Processing failed to start.");
      }
      void fetchJob(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed.";
      setError(msg);
      if (msg === "no_credits" || msg.includes("no_credits")) onOpenBuy();
    } finally {
      setSubmitting(false);
      setUploadPct(0);
    }
  };

  const pipelineSteps = [
    "Queued",
    "Analyzing video",
    "Generating variations",
    "Done",
  ] as const;

  const activeStepIndex =
    jobStatus === "queued"
      ? 0
      : jobStatus === "analyzing"
        ? 1
        : jobStatus === "generating"
          ? 2
          : jobStatus === "complete"
            ? 3
            : jobStatus === "failed"
              ? -1
              : -1;

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
          Usually <strong>2–4 minutes</strong> end-to-end (stub pipeline for now).
        </p>
      </section>

      {!user ? (
        <Card>
          <CardHeader>
            <CardTitle>Sign in required</CardTitle>
            <CardDescription>
              Video jobs are saved to your account and stored in Supabase. Sign
              in with Google to continue.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button type="button" onClick={onOpenSignIn}>
              Sign in
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <>
          <section className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={sourceMode === "upload" ? "default" : "outline"}
                onClick={() => setSourceMode("upload")}
                disabled={submitting}
              >
                Upload video
              </Button>
              <Button
                type="button"
                size="sm"
                variant={sourceMode === "url" ? "default" : "outline"}
                onClick={() => setSourceMode("url")}
                disabled={submitting}
              >
                YouTube URL
              </Button>
            </div>

            {sourceMode === "upload" ? (
              <div className="space-y-2">
                <Label>Video file (MP4, MOV, WebM — max 500 MB)</Label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
                  className="sr-only"
                  disabled={submitting}
                  onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={submitting}
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
                  className="border-input bg-background ring-ring/50 focus-visible:ring-[3px] h-12 w-full max-w-xl rounded-xl border px-4 text-base outline-none"
                  placeholder="https://www.youtube.com/watch?v=…"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  disabled={submitting}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="video-prompt">What do you want?</Label>
              <textarea
                id="video-prompt"
                className="border-input bg-background ring-ring/50 focus-visible:ring-[3px] min-h-[160px] w-full max-w-3xl resize-y rounded-xl border px-4 py-3 text-base outline-none"
                placeholder="Describe what you want: e.g. 'Grab the 5 most climactic moments from this vlog and create short clips I can post on TikTok to promote my YouTube'"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={submitting}
              />
            </div>

            {!creditsUnlimited ? (
              <p className="text-amber-600/90 text-sm dark:text-amber-400/90">
                This will use <strong>{VIDEO_JOB_CREDIT_COST} credits</strong>{" "}
                ({creditsRemaining} remaining).
              </p>
            ) : null}

            {submitting && uploadPct > 0 && uploadPct < 100 ? (
              <div className="max-w-md space-y-1">
                <Progress value={uploadPct}>
                  <div className="flex justify-between text-xs">
                    <ProgressLabel>Uploading</ProgressLabel>
                    <ProgressValue />
                  </div>
                </Progress>
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

          {jobId && jobStatus ? (
            <section className="space-y-4 border-t border-border pt-10">
              <h2 className="text-xl font-semibold">Status</h2>
              {jobStatus === "failed" ? (
                <p className="text-destructive text-sm">Something went wrong.</p>
              ) : (
                <ol className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-2 text-sm">
                  {pipelineSteps.map((label, i) => (
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
                          activeStepIndex >= i ? "bg-primary" : "bg-muted-foreground/30",
                        )}
                      />
                      {label}
                    </li>
                  ))}
                </ol>
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
                    {variations.map((v, idx) => (
                      <Card key={`${v.label}-${idx}`} className="overflow-hidden">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">
                            {v.label}
                          </CardTitle>
                          <CardDescription>Variation {idx + 1}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2 px-0">
                          <video
                            className="aspect-video w-full bg-black object-cover"
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
                            onClick={() =>
                              void navigator.clipboard.writeText(
                                `${v.label}\n${v.url}\n\n#TikTok #Shorts`,
                              )
                            }
                          >
                            Copy for TikTok
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void navigator.clipboard.writeText(
                                `${v.label}\n${v.url}\n\n#Reels #Instagram`,
                              )
                            }
                          >
                            Copy for Reels
                          </Button>
                        </CardFooter>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
