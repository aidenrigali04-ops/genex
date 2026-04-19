"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles, Video } from "lucide-react";

import { LazyVideoPlayer } from "@/components/lazy-video-player";
import { cn } from "@/lib/utils";

const VOICE_OPTIONS = [
  { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel (Female, Calm)" },
  { id: "AZnzlk1XvdvUeBnXmlld", label: "Domi (Female, Confident)" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Bella (Female, Soft)" },
  { id: "ErXwobaYiN019PkySvjV", label: "Antoni (Male, Well-rounded)" },
  { id: "VR6AewLTigWG4xSOukaG", label: "Arnold (Male, Crisp)" },
];

export type TextVideoShotPreview = {
  keyword: string;
  duration: number;
  caption: string;
};

type JobStatus =
  | "idle"
  | "previewing"
  | "queued"
  | "planning"
  | "fetching"
  | "assembling"
  | "uploading"
  | "complete"
  | "failed";

const STATUS_LABELS: Record<JobStatus, string> = {
  idle: "",
  previewing: "",
  queued: "Queued…",
  planning: "Planning shots with AI…",
  fetching: "Fetching B-roll footage…",
  assembling: "Assembling video…",
  uploading: "Uploading…",
  complete: "Done!",
  failed: "Failed",
};

const STATUS_ORDER: JobStatus[] = [
  "queued",
  "planning",
  "fetching",
  "assembling",
  "uploading",
  "complete",
];

type Props = {
  script: string;
  hooks: string;
  generationId?: string;
  onCreditChange?: (n: number) => void;
  variant?: "default" | "adaKit";
};

export function TextToVideoLauncher({
  script,
  hooks,
  generationId,
  onCreditChange,
  variant = "default",
}: Props) {
  const kit = variant === "adaKit";
  const [voiceId, setVoiceId] = useState(VOICE_OPTIONS[0].id);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [shotPreview, setShotPreview] = useState<TextVideoShotPreview[] | null>(
    null,
  );
  const [previewBusy, setPreviewBusy] = useState(false);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const voScript = [hooks.trim(), script.trim()].filter(Boolean).join("\n\n");

  const totalPreviewDuration =
    shotPreview?.reduce((s, sh) => s + (Number(sh.duration) || 0), 0) ?? 0;

  const updateShotPreview = (
    index: number,
    patch: Partial<TextVideoShotPreview>,
  ) => {
    setShotPreview((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const cur = next[index];
      if (!cur) return prev;
      let duration = cur.duration;
      if (patch.duration !== undefined) {
        const n = Number(patch.duration);
        duration = Number.isFinite(n)
          ? Math.min(8, Math.max(3, Math.round(n)))
          : cur.duration;
      }
      next[index] = {
        ...cur,
        ...patch,
        ...(patch.duration !== undefined ? { duration } : {}),
      };
      return next;
    });
  };

  const requestPreview = async () => {
    if (voScript.trim().length < 20) {
      setErrorMsg("Add a bit more script (at least 20 characters) to preview.");
      return;
    }
    setStatus("previewing");
    setPreviewBusy(true);
    setErrorMsg(null);
    setOutputUrl(null);
    setShotPreview(null);
    setJobId(null);

    try {
      const res = await fetch("/api/text-video-jobs/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: voScript }),
      });
      const data = (await res.json()) as {
        shots?: TextVideoShotPreview[];
        message?: string;
        error?: string;
      };

      if (!res.ok) {
        setStatus("failed");
        setErrorMsg(
          data.message ?? data.error ?? `Preview failed (${res.status})`,
        );
        return;
      }

      const shots = data.shots;
      if (!Array.isArray(shots) || shots.length < 3) {
        setStatus("failed");
        setErrorMsg("Shot plan was too short. Try again.");
        return;
      }

      setShotPreview(
        shots.map((s) => ({
          keyword: String(s.keyword ?? ""),
          duration: Math.min(
            8,
            Math.max(3, Math.round(Number(s.duration) || 5)),
          ),
          caption: String(s.caption ?? ""),
        })),
      );
    } catch {
      setStatus("failed");
      setErrorMsg("Network error while planning shots.");
    } finally {
      setPreviewBusy(false);
    }
  };

  const confirmAndGenerate = async () => {
    if (!shotPreview?.length) return;
    setStatus("queued");
    setErrorMsg(null);
    setOutputUrl(null);

    try {
      const res = await fetch("/api/text-video-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: voScript,
          generationId,
          voiceId,
          shotPlan: shotPreview,
        }),
      });

      const data = (await res.json()) as {
        id?: string;
        status?: JobStatus;
        credits_remaining?: number;
        message?: string;
        error?: string;
      };

      if (!res.ok) {
        setStatus("previewing");
        setErrorMsg(
          data.message ?? data.error ?? `Failed to start (${res.status})`,
        );
        return;
      }

      if (data.id) {
        setJobId(data.id);
        setStatus((data.status as JobStatus) ?? "queued");
      }
      if (typeof data.credits_remaining === "number") {
        onCreditChange?.(data.credits_remaining);
      }
    } catch {
      setStatus("previewing");
      setErrorMsg("Network error");
    }
  };

  const pollOnce = useCallback(async () => {
    if (!jobId) return;
    try {
      const res = await fetch(`/api/text-video-jobs/${jobId}`);
      const job = (await res.json()) as {
        status?: JobStatus;
        output_url?: string | null;
        error_message?: string | null;
        error?: string;
      };

      if (!res.ok) return;

      const next = (job.status ?? "queued") as JobStatus;
      setStatus(next);

      if (next === "complete" && job.output_url) {
        setOutputUrl(job.output_url);
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
      if (next === "failed") {
        setErrorMsg(job.error_message ?? job.error ?? "Unknown error");
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch {
      /* ignore transient poll errors */
    }
  }, [jobId]);

  useEffect(() => {
    if (
      !jobId ||
      status === "complete" ||
      status === "failed" ||
      status === "idle" ||
      status === "previewing"
    ) {
      return;
    }

    const t = window.setTimeout(() => void pollOnce(), 0);
    pollRef.current = setInterval(() => void pollOnce(), 4000);

    return () => {
      window.clearTimeout(t);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobId, status, pollOnce]);

  const isRunning =
    status !== "idle" &&
    status !== "previewing" &&
    status !== "complete" &&
    status !== "failed";
  const stepIndex = STATUS_ORDER.indexOf(status);
  const activeStep = stepIndex < 0 ? 0 : stepIndex;
  const selectedVoice = VOICE_OPTIONS.find((v) => v.id === voiceId) ?? VOICE_OPTIONS[0];

  const shell = kit
    ? "rounded-2xl border border-white/14 bg-white/[0.06] text-white outline outline-1 -outline-offset-1 outline-white/10 backdrop-blur-sm"
    : "rounded-xl border border-ada-border bg-ada-card text-ada-primary";

  return (
    <div className={cn("overflow-hidden", shell)}>
      <div
        className={cn(
          "flex items-center justify-between gap-3 border-b px-5 py-4",
          kit ? "border-white/12" : "border-ada-border",
        )}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg",
              kit
                ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)]"
                : "bg-gradient-to-br from-[#7B5CFA] to-[#9B6FFF]",
            )}
          >
            <Video className="h-4 w-4 text-white" aria-hidden />
          </div>
          <div>
            <h3
              className={cn(
                kit
                  ? "font-[family-name:var(--font-instrument-serif)] text-base font-normal tracking-[0.36px]"
                  : "text-sm font-semibold",
              )}
            >
              Generate Video
            </h3>
            <p
              className={cn(
                "text-xs",
                kit ? "text-white/50" : "text-ada-disabled",
              )}
            >
              B-roll + voiceover + captions · 5 credits · ~2–3 min
            </p>
          </div>
        </div>

        {status === "idle" || status === "previewing" ? (
          <button
            type="button"
            onClick={() => setVoiceOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors",
              kit
                ? "border-white/24 text-white/80 hover:border-white/40 hover:bg-white/10"
                : "border-ada-border text-ada-secondary hover:border-ada-border-active hover:text-ada-primary",
            )}
          >
            {selectedVoice.label.split(" (")[0]}
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", voiceOpen && "rotate-180")}
              aria-hidden
            />
          </button>
        ) : null}
      </div>

      {voiceOpen && (status === "idle" || status === "previewing") ? (
        <div
          className={cn(
            "space-y-0.5 border-b p-2",
            kit ? "border-white/12" : "border-ada-border",
          )}
        >
          {VOICE_OPTIONS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                setVoiceId(v.id);
                setVoiceOpen(false);
              }}
              className={cn(
                "w-full rounded-md px-3 py-2 text-left text-xs transition-colors",
                voiceId === v.id
                  ? kit
                    ? "bg-white/15 text-white"
                    : "bg-ada-accent-subtle text-ada-accent-hover"
                  : kit
                    ? "text-white/70 hover:bg-white/10"
                    : "text-ada-secondary hover:bg-ada-elevated",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="space-y-4 p-5">
        {status === "idle" ? (
          <div className="space-y-2">
            {errorMsg ? (
              <p
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs",
                  kit
                    ? "border-amber-400/35 bg-amber-950/30 text-amber-100"
                    : "border-ada-border bg-ada-elevated text-ada-secondary",
                )}
              >
                {errorMsg}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void requestPreview()}
              className={cn(
                "flex w-full items-center justify-center gap-2.5 rounded-[10px] py-3 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]",
                kit
                  ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] shadow-[0_0_20px_rgba(203,45,206,0.2)]"
                  : "bg-gradient-to-r from-[#7B5CFA] to-[#9B6FFF] shadow-lg shadow-[#7B5CFA22]",
              )}
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              Plan shots (free preview)
            </button>
            <p
              className={cn(
                "text-center text-[10px]",
                kit ? "text-white/45" : "text-[var(--ada-text-disabled)]",
              )}
            >
              5 credits when you generate the final video
            </p>
          </div>
        ) : null}

        {status === "previewing" ? (
          <div className="space-y-3">
            {previewBusy || !shotPreview ? (
              <div className="space-y-2">
                <p
                  className={cn(
                    "animate-pulse text-sm font-medium",
                    kit ? "text-white" : "text-ada-primary",
                  )}
                >
                  Planning shots with AI…
                </p>
                <p
                  className={cn(
                    "text-[10px]",
                    kit ? "text-white/45" : "text-[var(--ada-text-disabled)]",
                  )}
                >
                  No credits used · ~5s
                </p>
              </div>
            ) : (
              <>
                {errorMsg ? (
                  <p
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs",
                      kit
                        ? "border-amber-400/35 bg-amber-950/30 text-amber-100"
                        : "border-ada-error/30 bg-ada-error/10 text-ada-error",
                    )}
                  >
                    {errorMsg}
                  </p>
                ) : null}
                <p
                  className={cn(
                    "text-xs",
                    kit ? "text-white/55" : "text-[var(--ada-text-secondary)]",
                  )}
                >
                  AI planned {shotPreview.length} shots · {totalPreviewDuration}s
                  total
                </p>
                <div className="space-y-2">
                  {shotPreview.map((shot, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex items-start gap-3 rounded-[8px] border p-3",
                        kit
                          ? "border-white/14 bg-white/[0.06]"
                          : "border-[var(--ada-border)] bg-[var(--ada-bg-elevated)]",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-2 text-xs font-bold tabular-nums",
                          kit ? "text-[#D31CD7]" : "text-[var(--ada-accent)]",
                        )}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1 space-y-2">
                        <input
                          type="text"
                          value={shot.keyword}
                          onChange={(e) =>
                            updateShotPreview(i, { keyword: e.target.value })
                          }
                          className={cn(
                            "w-full rounded-md border px-2 py-1.5 text-xs font-medium outline-none",
                            kit
                              ? "border-white/20 bg-white/5 text-white placeholder:text-white/35"
                              : "border-[var(--ada-border)] bg-[var(--ada-bg-input)] text-[var(--ada-text-primary)] placeholder:text-[var(--ada-text-disabled)]",
                          )}
                          aria-label={`Shot ${i + 1} stock search keywords`}
                        />
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={shot.caption}
                            onChange={(e) =>
                              updateShotPreview(i, { caption: e.target.value })
                            }
                            className={cn(
                              "min-w-0 flex-1 rounded-md border px-2 py-1.5 text-[10px] outline-none",
                              kit
                                ? "border-white/20 bg-white/5 text-white/90"
                                : "border-[var(--ada-border)] bg-[var(--ada-bg-input)] text-[var(--ada-text-primary)]",
                            )}
                            aria-label={`Shot ${i + 1} caption`}
                          />
                          <input
                            type="number"
                            min={3}
                            max={8}
                            value={shot.duration}
                            onChange={(e) =>
                              updateShotPreview(i, {
                                duration: Number(e.target.value),
                              })
                            }
                            className={cn(
                              "w-14 shrink-0 rounded-md border px-2 py-1.5 text-center text-[10px] outline-none",
                              kit
                                ? "border-white/20 bg-white/5 text-white/90"
                                : "border-[var(--ada-border)] bg-[var(--ada-bg-input)] text-[var(--ada-text-primary)]",
                            )}
                            aria-label={`Shot ${i + 1} duration seconds`}
                          />
                        </div>
                        <p
                          className={cn(
                            "text-[10px]",
                            kit ? "text-white/40" : "text-[var(--ada-text-disabled)]",
                          )}
                        >
                          Stock: edit keywords · VO: caption · seconds (3–8)
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void confirmAndGenerate()}
                  disabled={
                    totalPreviewDuration < 30 || totalPreviewDuration > 90
                  }
                  className={cn(
                    "flex w-full items-center justify-center gap-2 rounded-[10px] py-3 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
                    kit
                      ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] shadow-[0_0_20px_rgba(203,45,206,0.2)]"
                      : "bg-gradient-to-r from-[#7B5CFA] to-[#9B6FFF] shadow-lg shadow-[#7B5CFA22]",
                  )}
                >
                  ✓ Looks good — Generate Video (5 credits)
                </button>
                {totalPreviewDuration < 30 || totalPreviewDuration > 90 ? (
                  <p
                    className={cn(
                      "text-center text-[10px]",
                      kit ? "text-amber-200/80" : "text-ada-error",
                    )}
                  >
                    Total duration must be 30–90s (currently {totalPreviewDuration}
                    s).
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setStatus("idle");
                    setShotPreview(null);
                    setErrorMsg(null);
                  }}
                  className={cn(
                    "w-full rounded-lg border py-2.5 text-xs font-medium transition-colors",
                    kit
                      ? "border-white/24 text-white/80 hover:bg-white/10"
                      : "border-[var(--ada-border)] text-[var(--ada-text-secondary)] hover:bg-[var(--ada-bg-elevated)]",
                  )}
                >
                  Regenerate shot plan
                </button>
              </>
            )}
          </div>
        ) : null}

        {isRunning ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p
                className={cn(
                  "animate-pulse text-sm font-medium",
                  kit ? "text-white" : "text-ada-primary",
                )}
              >
                {STATUS_LABELS[status]}
              </p>
              <span className={cn("text-xs", kit ? "text-white/45" : "text-ada-disabled")}>
                {activeStep + 1}/{STATUS_ORDER.length}
              </span>
            </div>
            <div className="flex gap-1">
              {STATUS_ORDER.filter((s) => s !== "complete").map((s, i) => (
                <div
                  key={s}
                  className={cn(
                    "h-1.5 flex-1 rounded-full transition-all duration-500",
                    i < activeStep
                      ? kit
                        ? "bg-[#D31CD7]"
                        : "bg-ada-accent"
                      : i === activeStep
                        ? kit
                          ? "animate-pulse bg-[#D31CD7]/70"
                          : "animate-pulse bg-ada-accent/60"
                        : kit
                          ? "bg-white/15"
                          : "bg-ada-border",
                  )}
                />
              ))}
            </div>
            <p className={cn("text-[10px]", kit ? "text-white/45" : "text-ada-disabled")}>
              Using Pexels B-roll + ElevenLabs voice · ~2–3 min
            </p>
          </div>
        ) : null}

        {status === "complete" && outputUrl ? (
          <div className="space-y-3">
            <div className="mx-auto w-[min(100%,200px)]">
              <LazyVideoPlayer
                src={outputUrl}
                className="aspect-[9/16] w-full overflow-hidden rounded-[10px]"
              />
            </div>
            <div className="flex gap-2">
              <a
                href={outputUrl}
                download
                className={cn(
                  "flex-1 rounded-lg border px-4 py-2 text-center text-xs font-medium transition-colors",
                  kit
                    ? "border-white/24 text-white/85 hover:border-white/40 hover:bg-white/10"
                    : "border-ada-border text-ada-secondary hover:border-ada-border-active hover:text-ada-primary",
                )}
              >
                Download MP4
              </a>
              <button
                type="button"
                onClick={() => {
                  setStatus("idle");
                  setOutputUrl(null);
                  setJobId(null);
                  setShotPreview(null);
                }}
                className={cn(
                  "flex-1 rounded-lg border px-4 py-2 text-xs font-medium transition-colors",
                  kit
                    ? "border-white/24 text-white/85 hover:border-white/40 hover:bg-white/10"
                    : "border-ada-border text-ada-secondary hover:border-ada-border-active hover:text-ada-primary",
                )}
              >
                Regenerate
              </button>
            </div>
          </div>
        ) : null}

        {status === "failed" ? (
          <div className="space-y-3">
            <p
              className={cn(
                "rounded-lg border px-4 py-3 text-sm",
                kit
                  ? "border-red-400/40 bg-red-950/40 text-red-200"
                  : "border-ada-error/30 bg-ada-error/10 text-ada-error",
              )}
            >
              {errorMsg ?? "Something went wrong. Try again."}
            </p>
            <button
              type="button"
              onClick={() => {
                setStatus("idle");
                setErrorMsg(null);
                setJobId(null);
                setShotPreview(null);
              }}
              className={cn(
                "rounded-lg border px-4 py-2 text-xs transition-colors",
                kit
                  ? "border-white/24 text-white/80 hover:bg-white/10"
                  : "border-ada-border text-ada-secondary hover:border-ada-border-active",
              )}
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
