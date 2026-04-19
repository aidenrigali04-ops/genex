"use client";

import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Play, Video, Zap } from "lucide-react";

import {
  UNLIMITED_CREDITS_SENTINEL,
} from "@/lib/credits-config";
import { cn } from "@/lib/utils";

const VOICE_OPTIONS = [
  { label: "Rachel", id: "21m00Tcm4TlvDq8ikWAM" },
  { label: "Adam", id: "pNInz6obpgDQGcFmaJgB" },
  { label: "Bella", id: "EXAVITQu4vr4xnSDxMaL" },
  { label: "Josh", id: "TxGEqnHWrfWFTfGW9XjX" },
] as const;

const DEFAULT_TEXT_VIDEO_CREDITS = Number(
  process.env.NEXT_PUBLIC_TEXT_VIDEO_CREDIT_COST ?? "5",
);

export type AdaVideoWorkspaceProps = {
  userId: string | null;
  creditsRemaining: number;
  creditsUnlimited: boolean;
  onCreditChange?: (remaining: number) => void;
  onJobFinished?: () => void;
  variant?: "default" | "adaKit";
};

export type VideoJob = {
  id: string;
  script: string;
  status: string;
  output_url: string | null;
  error_message: string | null;
  credit_cost: number;
  created_at: string;
};

const STATUS_MAP: Record<string, { label: string; pct: number }> = {
  queued: { label: "Waiting in queue…", pct: 5 },
  planning: { label: "Planning shots…", pct: 20 },
  fetching: { label: "Finding footage…", pct: 45 },
  assembling: { label: "Assembling your video…", pct: 75 },
  uploading: { label: "Uploading…", pct: 90 },
  complete: { label: "Done!", pct: 100 },
  failed: { label: "Generation failed", pct: 0 },
  cancelled: { label: "Cancelled", pct: 0 },
};

const POLL_MS = 3000;
const SCRIPT_MIN_LEN = 20;

function relativeFromNow(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "Just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function parseJobListPayload(json: unknown): VideoJob[] {
  if (!json || typeof json !== "object") return [];
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : null;
      const script = typeof r.script === "string" ? r.script : "";
      const status = typeof r.status === "string" ? r.status : "queued";
      const output_url =
        typeof r.output_url === "string" ? r.output_url : null;
      const error_message =
        typeof r.error_message === "string" ? r.error_message : null;
      const credit_cost =
        typeof r.credit_cost === "number" ? r.credit_cost : DEFAULT_TEXT_VIDEO_CREDITS;
      const created_at =
        typeof r.created_at === "string" ? r.created_at : new Date().toISOString();
      if (!id) return null;
      return {
        id,
        script,
        status,
        output_url,
        error_message,
        credit_cost,
        created_at,
      } satisfies VideoJob;
    })
    .filter((j): j is VideoJob => j != null);
}

function parseJobGetPayload(json: unknown): Partial<VideoJob> & { id?: string } {
  if (!json || typeof json !== "object") return {};
  const r = json as Record<string, unknown>;
  return {
    id: typeof r.id === "string" ? r.id : undefined,
    status: typeof r.status === "string" ? r.status : undefined,
    output_url:
      typeof r.output_url === "string"
        ? r.output_url
        : r.output_url === null
          ? null
          : undefined,
    error_message:
      typeof r.error_message === "string"
        ? r.error_message
        : r.error_message === null
          ? null
          : undefined,
    script: typeof r.script === "string" ? r.script : undefined,
    credit_cost:
      typeof r.credit_cost === "number" ? r.credit_cost : undefined,
    created_at: typeof r.created_at === "string" ? r.created_at : undefined,
  };
}

export function AdaVideoWorkspace({
  userId,
  creditsRemaining,
  creditsUnlimited,
  onCreditChange,
  onJobFinished,
  variant = "default",
}: AdaVideoWorkspaceProps): JSX.Element {
  const kit = variant === "adaKit";
  const [inputMode, setInputMode] = useState<"url" | "text">("url");
  const [urlValue, setUrlValue] = useState("");
  const [textValue, setTextValue] = useState("");
  const [selectedVoice, setSelectedVoice] = useState<string>(
    VOICE_OPTIONS[0].id,
  );
  const [activeJob, setActiveJob] = useState<string | null>(null);
  const [activeJobData, setActiveJobData] = useState<VideoJob | null>(null);
  const [jobHistory, setJobHistory] = useState<VideoJob[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeTerminalNote, setActiveTerminalNote] = useState<string | null>(
    null,
  );

  const activeJobDataRef = useRef<VideoJob | null>(null);
  activeJobDataRef.current = activeJobData;

  const creditCost = useMemo(() => {
    const fromJobs = jobHistory[0]?.credit_cost;
    if (typeof fromJobs === "number" && fromJobs > 0) return fromJobs;
    return DEFAULT_TEXT_VIDEO_CREDITS;
  }, [jobHistory]);

  const creditCostRef = useRef(creditCost);
  creditCostRef.current = creditCost;

  const creditsOk =
    creditsUnlimited || creditsRemaining === UNLIMITED_CREDITS_SENTINEL
      ? true
      : creditsRemaining >= creditCost;

  const loadHistory = useCallback(async () => {
    if (!userId) {
      setJobHistory([]);
      setLoadingHistory(false);
      return;
    }
    try {
      const res = await fetch("/api/text-video-jobs", { credentials: "same-origin" });
      if (!res.ok) {
        setLoadingHistory(false);
        return;
      }
      const json = (await res.json()) as unknown;
      setJobHistory(parseJobListPayload(json));
    } catch {
      /* silent */
    } finally {
      setLoadingHistory(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!activeJob || !userId) {
      stopPolling();
      return;
    }

    const tick = async () => {
      try {
        const res = await fetch(`/api/text-video-jobs/${activeJob}`, {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const json = (await res.json()) as unknown;
        const p = parseJobGetPayload(json);
        const prev = activeJobDataRef.current;
        const job: VideoJob = {
          id: activeJob,
          script: p.script ?? prev?.script ?? "",
          status: p.status ?? "queued",
          output_url:
            p.output_url !== undefined ? p.output_url : prev?.output_url ?? null,
          error_message:
            p.error_message !== undefined
              ? p.error_message
              : prev?.error_message ?? null,
          credit_cost: p.credit_cost ?? prev?.credit_cost ?? creditCostRef.current,
          created_at:
            p.created_at ?? prev?.created_at ?? new Date().toISOString(),
        };
        activeJobDataRef.current = job;
        setActiveJobData(job);

        const st = job.status;
        if (st === "complete") {
          stopPolling();
          setActiveJob(null);
          setActiveJobData(null);
          activeJobDataRef.current = null;
          setActiveTerminalNote(null);
          void loadHistory();
          onJobFinished?.();
          return;
        }
        if (st === "failed" || st === "cancelled") {
          stopPolling();
          setActiveJob(null);
          setActiveJobData(null);
          activeJobDataRef.current = null;
          setActiveTerminalNote(
            st === "cancelled"
              ? "Generation was cancelled."
              : job.error_message?.trim() || "Generation failed.",
          );
          void loadHistory();
        }
      } catch {
        /* silent */
      }
    };

    void tick();
    pollRef.current = window.setInterval(() => {
      void tick();
    }, POLL_MS);

    return () => {
      stopPolling();
    };
  }, [activeJob, userId, loadHistory, onJobFinished, stopPolling]);

  const handleCancel = useCallback(async () => {
    if (!activeJob) return;
    stopPolling();
    try {
      await fetch(`/api/text-video-jobs/${activeJob}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
    } catch {
      /* silent */
    }
    setActiveJob(null);
    setActiveJobData(null);
    setActiveTerminalNote("Generation was cancelled.");
    void loadHistory();
  }, [activeJob, loadHistory, stopPolling]);

  const handleGenerate = async (): Promise<void> => {
    const input = inputMode === "url" ? urlValue.trim() : textValue.trim();
    setSubmitError(null);
    setActiveTerminalNote(null);
    if (!userId) {
      setSubmitError("Sign in to generate a video.");
      return;
    }
    if (!input || isSubmitting) return;
    if (input.length < SCRIPT_MIN_LEN) {
      setSubmitError(`Enter at least ${SCRIPT_MIN_LEN} characters.`);
      return;
    }
    if (activeJob) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/text-video-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ script: input, voiceId: selectedVoice }),
      });
      const json = (await res.json()) as {
        id?: string;
        error?: string;
        message?: string;
        credits_remaining?: number;
        credit_cost?: number;
        status?: string;
        created_at?: string;
      };
      if (!res.ok || json.error) {
        if (json.error === "no_credits") {
          setSubmitError("Not enough credits. Upgrade to continue.");
        } else if (res.status === 401) {
          setSubmitError("Sign in to generate a video.");
        } else {
          setSubmitError(json.message ?? json.error ?? "Could not start generation.");
        }
        return;
      }
      const id = json.id;
      if (!id || typeof id !== "string") {
        setSubmitError("Could not start generation.");
        return;
      }
      if (typeof json.credits_remaining === "number") {
        onCreditChange?.(json.credits_remaining);
      }
      setActiveJob(id);
      const row: VideoJob = {
        id,
        script: input,
        status: json.status ?? "queued",
        output_url: null,
        error_message: null,
        credit_cost:
          typeof json.credit_cost === "number" ? json.credit_cost : creditCost,
        created_at: json.created_at ?? new Date().toISOString(),
      };
      activeJobDataRef.current = row;
      setActiveJobData(row);
    } catch {
      /* silent */
    } finally {
      setIsSubmitting(false);
    }
  };

  const statusKey = activeJobData?.status ?? "queued";
  const statusInfo = STATUS_MAP[statusKey] ?? STATUS_MAP.queued;
  const progressPct = statusInfo.pct;
  const progressHint =
    statusKey === "fetching" && activeJobData?.error_message?.trim()
      ? activeJobData.error_message.trim()
      : null;

  const pillIdle =
    "border-ada-border text-ada-secondary hover:border-ada-border-active";
  const pillActive = "border-transparent bg-ada-accent text-white";

  const rootClass = kit
    ? "flex h-full min-h-0 flex-col bg-[#0D0A1E] font-[family-name:var(--font-instrument-sans)] text-white"
    : "flex h-full min-h-0 flex-col bg-ada-app text-ada-primary";

  return (
    <div className={rootClass}>
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-5 overflow-y-auto px-4 py-6">
        <p
          className={cn(
            "text-sm",
            kit ? "text-white/70" : "text-ada-secondary",
          )}
        >
          Paste a YouTube URL or your idea
        </p>

        {/* ZONE 1 */}
        <div className="space-y-4 rounded-2xl border border-ada-border bg-ada-card p-5">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Input source">
            {(["url", "text"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={inputMode === mode}
                onClick={() => setInputMode(mode)}
                className={cn(
                  "rounded-full border px-3 py-2 text-xs font-medium transition-colors",
                  inputMode === mode ? pillActive : pillIdle,
                )}
              >
                {mode === "url" ? "YouTube URL" : "Your Idea"}
              </button>
            ))}
          </div>

          {inputMode === "url" ? (
            <input
              type="url"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className={cn(
                "w-full rounded-xl border border-ada-border bg-ada-input px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ada-accent",
                kit && "border-white/14 bg-white/[0.06] text-white placeholder:text-white/40",
              )}
            />
          ) : (
            <textarea
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder="Describe your video idea in a sentence or two…"
              rows={3}
              className={cn(
                "w-full resize-none rounded-xl border border-ada-border bg-ada-input px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ada-accent",
                kit && "border-white/14 bg-white/[0.06] text-white placeholder:text-white/40",
              )}
            />
          )}

          <div className="space-y-2">
            <span className="text-xs font-medium text-ada-secondary">Voice</span>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {VOICE_OPTIONS.map((v) => {
                const sel = selectedVoice === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedVoice(v.id)}
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-2 text-xs font-medium transition-colors",
                      sel ? pillActive : pillIdle,
                      kit && !sel && "border-white/20 text-white/70 hover:border-white/40",
                    )}
                  >
                    {v.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              disabled={
                !userId ||
                isSubmitting ||
                activeJob !== null ||
                !creditsOk ||
                (inputMode === "url" ? !urlValue.trim() : !textValue.trim())
              }
              onClick={() => void handleGenerate()}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF] py-3 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                  Generating…
                </>
              ) : (
                <>
                  <Zap className="size-4 shrink-0 opacity-90" aria-hidden />
                  Generate Video
                </>
              )}
            </button>
            {!creditsOk ? (
              <p className="text-center text-[10px] text-amber-600 dark:text-amber-300/90">
                Not enough credits. Upgrade to continue.
              </p>
            ) : (
              <p className="text-center text-[10px] text-ada-disabled">
                {creditCost} credits
              </p>
            )}
            {submitError ? (
              <p className="text-center text-xs text-[var(--ada-error)]" role="alert">
                {submitError}
              </p>
            ) : null}
          </div>
        </div>

        {/* ZONE 2 */}
        {activeJob && activeJobData ? (
          <div className="space-y-3 rounded-2xl border border-ada-border bg-ada-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="h-2 w-2 shrink-0 rounded-full bg-ada-accent animate-pulse" />
                <span className="truncate text-sm font-medium text-ada-primary">
                  {statusInfo.label}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleCancel()}
                className="shrink-0 text-xs text-ada-disabled transition-colors hover:text-[var(--ada-error)]"
                aria-label="Cancel video generation"
              >
                Cancel
              </button>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-ada-border">
              <div
                className="h-full rounded-full bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF] transition-all duration-700 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {progressHint ? (
              <p className="text-[10px] text-ada-disabled">{progressHint}</p>
            ) : null}
          </div>
        ) : null}

        {activeTerminalNote && !activeJob ? (
          <div
            className="rounded-2xl border border-ada-border bg-ada-card px-4 py-3 text-sm text-ada-secondary"
            role="status"
          >
            {activeTerminalNote}
          </div>
        ) : null}

        {/* ZONE 3 */}
        <div className="min-h-0 flex-1">
          <h3
            className={cn(
              "mb-3 text-xs font-semibold tracking-wide text-ada-secondary uppercase",
              kit && "text-white/50",
            )}
          >
            Recent videos
          </h3>
          {loadingHistory ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-8 animate-spin text-ada-accent" aria-hidden />
            </div>
          ) : jobHistory.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ada-accent-subtle">
                <Video className="h-5 w-5 text-ada-accent" aria-hidden />
              </div>
              <p className="text-sm font-medium text-ada-secondary">No videos yet</p>
              <p className="max-w-[200px] text-xs leading-relaxed text-ada-disabled">
                Paste a YouTube URL above and generate your first short-form video.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-4 pb-8">
              {jobHistory.map((job) => (
                <li key={job.id}>
                  <VideoJobCard job={job} kit={kit} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function VideoJobCard({
  job,
  kit,
}: {
  job: VideoJob;
  kit: boolean;
}): JSX.Element {
  const st = job.status;
  const badgeClass =
    st === "complete"
      ? "bg-green-500/15 text-green-600 dark:text-green-400"
      : st === "failed"
        ? "bg-[var(--ada-error)]/15 text-[var(--ada-error)]"
        : st === "cancelled"
          ? "border border-ada-border bg-transparent text-ada-disabled"
          : "bg-ada-accent-subtle text-ada-accent";

  const preview = job.output_url ? (
    <video
      className="h-full w-full object-cover"
      src={job.output_url}
      preload="metadata"
      muted
      playsInline
      aria-label="Video preview"
    />
  ) : (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center bg-linear-to-br from-[#7B5CFA]/25 to-[#9B6FFF]/15",
        kit && "from-[#D31CD7]/20 to-[#8800DC]/15",
      )}
    >
      <Video className="size-8 text-ada-accent opacity-80" aria-hidden />
    </div>
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-ada-border bg-ada-card">
      <div className="aspect-video w-full bg-ada-border">{preview}</div>
      <div className="space-y-2 p-4">
        <p className="line-clamp-1 text-sm text-ada-primary">{job.script}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
              badgeClass,
            )}
          >
            {st}
          </span>
          <span
            className="text-[10px] text-ada-disabled"
            suppressHydrationWarning
          >
            {relativeFromNow(job.created_at)}
          </span>
        </div>
        {st === "complete" && job.output_url ? (
          <div className="flex gap-2 pt-1">
            <a
              href={job.output_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex size-9 items-center justify-center rounded-full border border-ada-border text-ada-primary transition-colors hover:bg-ada-elevated"
              aria-label="Play video"
            >
              <Play className="size-4" />
            </a>
            <a
              href={job.output_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex size-9 items-center justify-center rounded-full border border-ada-border text-ada-primary transition-colors hover:bg-ada-elevated"
              aria-label="Download video"
            >
              <Download className="size-4" />
            </a>
          </div>
        ) : null}
        {st === "failed" ? (
          <p className="text-[10px] text-ada-disabled">No credits were charged.</p>
        ) : null}
      </div>
    </div>
  );
}
