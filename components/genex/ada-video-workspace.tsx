"use client";

import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Play, Video, Zap } from "lucide-react";

import { UNLIMITED_CREDITS_SENTINEL } from "@/lib/credits-config";
import { cn } from "@/lib/utils";

const VOICE_OPTIONS = [
  { label: "Rachel", id: "21m00Tcm4TlvDq8ikWAM", desc: "Warm & clear" },
  { label: "Adam", id: "pNInz6obpgDQGcFmaJgB", desc: "Deep & authoritative" },
  { label: "Bella", id: "EXAVITQu4vr4xnSDxMaL", desc: "Bright & energetic" },
  { label: "Josh", id: "TxGEqnHWrfWFTfGW9XjX", desc: "Casual & conversational" },
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
  onUpgrade?: () => void;
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

const STEP_ORDER = [
  "queued",
  "planning",
  "fetching",
  "assembling",
  "uploading",
  "complete",
] as const;

const STEP_HINTS: { status: string; label: string }[] = [
  { status: "planning", label: "Writing shot plan" },
  { status: "fetching", label: "Finding B-roll footage" },
  { status: "assembling", label: "Assembling your video" },
  { status: "uploading", label: "Uploading" },
];

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

function stepOrderIndex(status: string): number {
  return (STEP_ORDER as readonly string[]).indexOf(status);
}

export function AdaVideoWorkspace({
  userId,
  creditsRemaining,
  creditsUnlimited,
  onCreditChange,
  onJobFinished,
  onUpgrade,
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
      if (res.status === 402 || json.error === "no_credits") {
        onUpgrade?.();
        return;
      }
      if (!res.ok || json.error) {
        if (res.status === 401) {
          setSubmitError("Sign in to generate a video.");
        } else {
          setSubmitError(json.message ?? json.error ?? "Could not start generation.");
        }
        return;
      }
      const id = json.id;
      if (!id || typeof id !== "string") {
        setSubmitError(json.error ?? "Could not start generation.");
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

  const statusIdx = stepOrderIndex(statusKey);

  const rootClass = kit
    ? "relative flex h-full min-h-0 flex-col overflow-hidden bg-[#0A050F] font-[family-name:var(--font-instrument-sans)] text-white"
    : "flex h-full min-h-0 flex-col bg-ada-app text-ada-primary";

  return (
    <div className={rootClass}>
      {kit ? (
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden"
          aria-hidden
        >
          <div className="absolute -left-[20%] top-[-18%] h-[min(90vh,52rem)] w-[min(140vw,85rem)] -rotate-[13deg] rounded-[3rem] bg-[#180532] opacity-90 blur-[120px]" />
          <div className="absolute -right-[25%] bottom-[-35%] h-[min(85vh,48rem)] w-[min(130vw,80rem)] rotate-[148deg] rounded-[3rem] bg-[#300537] opacity-85 blur-[120px]" />
          <div className="absolute left-[15%] bottom-[-40%] h-[min(70vh,40rem)] w-[min(120vw,72rem)] -rotate-[57deg] rounded-[3rem] bg-[#230639] opacity-80 blur-[120px]" />
        </div>
      ) : null}

      <div className="relative z-[1] mx-auto grid h-full w-full max-w-5xl grid-cols-1 gap-6 overflow-hidden px-4 py-6 lg:grid-cols-[380px_1fr]">
        {/* Left column */}
        <div className="flex min-h-0 flex-col gap-4 lg:overflow-y-auto lg:pb-8">
          <div className="rounded-2xl border border-ada-border bg-ada-card p-5 space-y-4">
            <div>
              <h2
                className={cn(
                  "text-sm font-semibold",
                  kit ? "text-white" : "text-ada-primary",
                )}
              >
                Got a video idea?
              </h2>
              <p
                className={cn(
                  "text-xs mt-0.5",
                  kit ? "text-white/45" : "text-ada-disabled",
                )}
              >
                Drop a YouTube URL or describe your idea — GenEx handles the rest.
              </p>
            </div>

            <div
              className="flex gap-1 rounded-full border border-ada-border bg-ada-app p-0.5"
              role="tablist"
              aria-label="Input source"
            >
              {(["url", "text"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={inputMode === mode}
                  onClick={() => setInputMode(mode)}
                  className={cn(
                    "flex-1 rounded-full py-1.5 text-xs font-medium transition-colors",
                    inputMode === mode
                      ? "bg-ada-accent text-white shadow-sm"
                      : "text-ada-secondary hover:text-ada-primary",
                    kit &&
                      inputMode === mode &&
                      "bg-linear-to-br from-[#D31CD7] to-[#8800DC] shadow-[0_0_12px_rgba(203,45,206,0.2)]",
                    kit &&
                      inputMode !== mode &&
                      "text-white/55 hover:text-white/80",
                  )}
                >
                  {mode === "url" ? "YouTube URL" : "My Idea"}
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
                  "w-full rounded-xl border border-ada-border bg-ada-input px-3 py-2.5 text-sm outline-none transition-colors focus-visible:border-ada-accent focus-visible:ring-2 focus-visible:ring-ada-accent/20",
                  kit && "border-white/14 bg-white/[0.06] text-white placeholder:text-white/35",
                )}
              />
            ) : (
              <textarea
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                placeholder="e.g. '5 habits that changed my morning routine'"
                rows={3}
                className={cn(
                  "w-full resize-none rounded-xl border border-ada-border bg-ada-input px-3 py-2.5 text-sm outline-none transition-colors focus-visible:border-ada-accent focus-visible:ring-2 focus-visible:ring-ada-accent/20",
                  kit && "border-white/14 bg-white/[0.06] text-white placeholder:text-white/35",
                )}
              />
            )}
          </div>

          <div
            className={cn(
              "rounded-2xl border border-ada-border bg-ada-card p-4 space-y-3",
              kit && "border-white/16 bg-white/[0.12] backdrop-blur-md",
            )}
          >
            <p
              className={cn(
                "text-xs font-semibold uppercase tracking-widest",
                kit ? "text-white/40" : "text-ada-disabled",
              )}
            >
              Voice
            </p>
            <div className="grid grid-cols-2 gap-2">
              {VOICE_OPTIONS.map((v) => {
                const sel = selectedVoice === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedVoice(v.id)}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition-colors",
                      sel
                        ? "border-ada-accent bg-ada-accent-subtle"
                        : cn(
                            "border-ada-border hover:border-ada-border-active",
                            kit && "border-white/12 hover:border-white/25",
                          ),
                      kit &&
                        sel &&
                        "border-transparent bg-linear-to-br from-[#D31CD7]/35 to-[#8800DC]/25",
                    )}
                  >
                    <p
                      className={cn(
                        "text-xs font-semibold",
                        sel
                          ? "text-ada-accent"
                          : kit
                            ? "text-white/80"
                            : "text-ada-primary",
                      )}
                    >
                      {v.label}
                    </p>
                    <p
                      className={cn(
                        "text-[10px] mt-0.5",
                        sel
                          ? "text-ada-accent/70"
                          : kit
                            ? "text-white/35"
                            : "text-ada-disabled",
                      )}
                    >
                      {v.desc}
                    </p>
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
                (inputMode === "url"
                  ? !urlValue.trim()
                  : textValue.trim().length < SCRIPT_MIN_LEN)
              }
              onClick={() => void handleGenerate()}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-full bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF] py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
                kit && "shadow-[0_16px_24px_rgba(123,92,250,0.2)] ring-1 ring-white/15",
              )}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                  Starting…
                </>
              ) : activeJob ? (
                <>
                  <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                  Generating…
                </>
              ) : (
                <>
                  <Zap className="size-4 shrink-0" aria-hidden />
                  Make my video
                </>
              )}
            </button>

            {!creditsOk ? (
              <p className="text-center text-[11px] text-amber-500 dark:text-amber-300">
                Not enough credits —{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => onUpgrade?.()}
                >
                  upgrade
                </button>
              </p>
            ) : (
              <p className="text-center text-[10px] text-ada-disabled">
                Uses {creditCost} credits per video
              </p>
            )}

            {submitError ? (
              <p className="text-center text-xs text-[var(--ada-error)]" role="alert">
                {submitError}
                {submitError.toLowerCase().includes("credit") ? (
                  <> — no credits were charged.</>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>

        {/* Right column */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-8">
          {activeJob && activeJobData ? (
            <div
              className={cn(
                "overflow-hidden rounded-2xl border border-ada-border bg-ada-card",
                kit && "border-white/20 bg-white/[0.08] backdrop-blur-sm",
              )}
            >
              <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
                <div className="mx-auto aspect-[9/16] w-full max-w-[120px] shrink-0 overflow-hidden rounded-xl bg-linear-to-br from-[#7B5CFA]/20 to-[#9B6FFF]/10 sm:mx-0">
                  <div className="flex h-full items-center justify-center">
                    <Loader2
                      className="size-6 animate-spin text-ada-accent opacity-60"
                      aria-hidden
                    />
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 shrink-0 rounded-full bg-ada-accent animate-pulse" />
                      <span
                        className={cn(
                          "text-sm font-semibold",
                          kit ? "text-white" : "text-ada-primary",
                        )}
                      >
                        {statusInfo.label}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCancel()}
                      className="text-xs text-ada-disabled transition-colors hover:text-[var(--ada-error)]"
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

                  <div className="space-y-1.5">
                    {STEP_HINTS.map((hint) => {
                      const hintIdx = stepOrderIndex(hint.status);
                      const done =
                        statusIdx >= 0 && hintIdx >= 0 && hintIdx < statusIdx;
                      const active = hint.status === statusKey;
                      return (
                        <div key={hint.status} className="flex items-center gap-2">
                          <div
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
                              done
                                ? "bg-ada-accent"
                                : active
                                  ? "bg-ada-accent animate-pulse"
                                  : "bg-ada-border",
                            )}
                          />
                          <span
                            className={cn(
                              "text-[11px] transition-colors",
                              done
                                ? "text-ada-accent"
                                : active
                                  ? kit
                                    ? "text-white/80"
                                    : "text-ada-primary"
                                  : kit
                                    ? "text-white/20"
                                    : "text-ada-disabled",
                            )}
                          >
                            {hint.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {progressHint ? (
                    <p className="text-[10px] text-ada-disabled italic">{progressHint}</p>
                  ) : null}

                  <p
                    className={cn(
                      "line-clamp-3 text-xs leading-relaxed",
                      kit ? "text-white/40" : "text-ada-disabled",
                    )}
                  >
                    {activeJobData.script}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {activeTerminalNote && !activeJob ? (
            <div
              className={cn(
                "rounded-2xl border border-ada-border bg-ada-card px-4 py-3 text-sm text-ada-secondary",
                kit && "border-white/20 bg-white/[0.06] text-white/80",
              )}
              role="status"
            >
              {activeTerminalNote}
              {activeTerminalNote.toLowerCase().includes("fail") ? (
                <span className="block text-[10px] text-ada-disabled mt-1">
                  No credits were charged.
                </span>
              ) : null}
            </div>
          ) : null}

          {!loadingHistory && jobHistory.length > 0 ? (
            <p
              className={cn(
                "text-[10px] font-semibold uppercase tracking-widest",
                kit ? "text-white/30" : "text-ada-disabled",
              )}
            >
              Your clips
            </p>
          ) : null}

          {loadingHistory ? (
            <div className="flex flex-1 justify-center py-10">
              <Loader2
                className={cn(
                  "size-8 animate-spin",
                  kit ? "text-[#C717D8]" : "text-ada-accent",
                )}
                aria-hidden
              />
            </div>
          ) : jobHistory.length === 0 && !activeJob ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
              <div
                className={cn(
                  "flex h-14 w-14 items-center justify-center rounded-2xl",
                  kit ? "bg-white/6" : "bg-ada-accent-subtle",
                )}
              >
                <Video className="h-6 w-6 text-ada-accent" aria-hidden />
              </div>
              <div>
                <p
                  className={cn(
                    "text-sm font-semibold",
                    kit ? "text-white/70" : "text-ada-primary",
                  )}
                >
                  Your first clip lives here
                </p>
                <p
                  className={cn(
                    "mt-1 max-w-[220px] text-xs leading-relaxed",
                    kit ? "text-white/30" : "text-ada-disabled",
                  )}
                >
                  Drop a YouTube URL on the left and hit{" "}
                  <span
                    className={cn(
                      kit ? "text-white/60 font-medium" : "font-medium text-ada-secondary",
                    )}
                  >
                    Make my video
                  </span>
                  . Done in under 2 minutes.
                </p>
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-4">
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
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const st = job.status;

  const handlePlayToggle = (): void => {
    if (!videoRef.current) return;
    if (playing) {
      videoRef.current.pause();
      setPlaying(false);
    } else {
      void videoRef.current.play();
      setPlaying(true);
    }
  };

  const badgeClass =
    st === "complete"
      ? "bg-green-500/15 text-green-500"
      : st === "failed"
        ? "bg-[var(--ada-error)]/15 text-[var(--ada-error)]"
        : st === "cancelled"
          ? "border border-ada-border bg-transparent text-ada-disabled"
          : "bg-ada-accent-subtle text-ada-accent";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-ada-border bg-ada-card",
        kit && "border-white/14 bg-white/[0.06] backdrop-blur-sm",
      )}
    >
      <div className="flex gap-4 p-4">
        <div className="relative aspect-[9/16] w-[80px] shrink-0 overflow-hidden rounded-xl bg-ada-border">
          {st === "complete" && job.output_url ? (
            <>
              <video
                ref={videoRef}
                src={job.output_url}
                className="h-full w-full object-cover"
                preload="metadata"
                muted
                playsInline
                loop
                onEnded={() => setPlaying(false)}
                onPause={() => setPlaying(false)}
                onPlay={() => setPlaying(true)}
                aria-label="Video clip preview"
              />
              <button
                type="button"
                onClick={handlePlayToggle}
                className="absolute inset-0 flex items-center justify-center transition-opacity hover:bg-black/20"
                aria-label={playing ? "Pause video" : "Play video"}
              >
                {!playing ? (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-md">
                    <Play className="size-3.5 text-[#7B5CFA] ml-0.5" aria-hidden />
                  </div>
                ) : null}
              </button>
            </>
          ) : (
            <div
              className={cn(
                "flex h-full w-full items-center justify-center bg-linear-to-br",
                kit ? "from-[#D31CD7]/15 to-[#8800DC]/10" : "from-[#7B5CFA]/20 to-[#9B6FFF]/10",
              )}
            >
              <Video className="size-5 text-ada-accent opacity-50" aria-hidden />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p
            className={cn(
              "line-clamp-2 text-xs font-medium leading-relaxed",
              kit ? "text-white/70" : "text-ada-primary",
            )}
          >
            {job.script}
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                badgeClass,
              )}
            >
              {st}
            </span>
            <span className="text-[10px] text-ada-disabled" suppressHydrationWarning>
              {relativeFromNow(job.created_at)}
            </span>
          </div>

          {st === "complete" && job.output_url ? (
            <div className="mt-auto flex gap-1.5 pt-1">
              <a
                href={job.output_url}
                target="_blank"
                rel="noreferrer"
                download
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
                  kit
                    ? "border-white/20 text-white/70 hover:border-white/40"
                    : "border-ada-border text-ada-secondary hover:border-ada-border-active hover:text-ada-primary",
                )}
                aria-label="Download video"
              >
                <Download className="size-3" aria-hidden />
                Download
              </a>
            </div>
          ) : null}

          {st === "failed" ? (
            <p className="text-[10px] text-ada-disabled">No credits were charged.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
