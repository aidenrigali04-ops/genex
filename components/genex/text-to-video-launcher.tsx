"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Video } from "lucide-react";

import { LazyVideoPlayer } from "@/components/lazy-video-player";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  normalizeVariationCount,
  validateDurationOptions,
} from "@/lib/clip-generation-options";
import type { ClipLengthMode } from "@/lib/clip-generation-options";
import { cn } from "@/lib/utils";

const VOICE_OPTIONS = [
  { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel" },
  { id: "AZnzlk1XvdvUeBnXmlld", label: "Domi" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Bella" },
  { id: "ErXwobaYiN019PkySvjV", label: "Antoni" },
  { id: "VR6AewLTigWG4xSOukaG", label: "Arnold" },
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

/** Short, user-facing progress line (no internal jargon). */
function runningHeadline(status: JobStatus): string {
  switch (status) {
    case "queued":
      return "Starting…";
    case "planning":
      return "Planning your scenes…";
    case "fetching":
      return "Gathering stock footage…";
    case "assembling":
      return "Building your video…";
    case "uploading":
      return "Finishing up…";
    default:
      return "Working…";
  }
}

function formatElapsed(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

type Props = {
  script: string;
  hooks: string;
  generationId?: string;
  /** Passed to shot planner (e.g. viral, curiosity, contrarian). */
  hookStyle?: string;
  onCreditChange?: (n: number) => void;
  variant?: "default" | "adaKit";
};

export function TextToVideoLauncher({
  script,
  hooks,
  generationId,
  hookStyle = "viral",
  onCreditChange,
  variant = "default",
}: Props) {
  const kit = variant === "adaKit";
  const [voiceId, setVoiceId] = useState(VOICE_OPTIONS[0].id);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [shotPreview, setShotPreview] = useState<TextVideoShotPreview[] | null>(
    null,
  );
  const [previewBusy, setPreviewBusy] = useState(false);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** Server `error_message` while status is `fetching` — reused as a progress hint, not an error. */
  const [fetchHint, setFetchHint] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [variationPreset, setVariationPreset] = useState<
    "1" | "2" | "3" | "5" | "custom"
  >("3");
  const [variationCustomStr, setVariationCustomStr] = useState("6");
  const [clipLengthMode, setClipLengthMode] = useState<ClipLengthMode>("auto");
  const [minDurationStr, setMinDurationStr] = useState("");
  const [maxDurationStr, setMaxDurationStr] = useState("");

  const voScript = [hooks.trim(), script.trim()].filter(Boolean).join("\n\n");

  const resolvedVariationCount = () =>
    variationPreset === "custom"
      ? normalizeVariationCount(Number.parseInt(variationCustomStr, 10))
      : normalizeVariationCount(Number.parseInt(variationPreset, 10));

  const buildPlannerBody = () => {
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
    return {
      variationCount: resolvedVariationCount(),
      clipLengthMode,
      minDurationSec,
      maxDurationSec,
    };
  };

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
          ? Math.min(12, Math.max(2, Math.round(n)))
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
      setErrorMsg("Add a little more script to continue (20+ characters).");
      return;
    }
    const extra = buildPlannerBody();
    const dur = validateDurationOptions({
      clipLengthMode: extra.clipLengthMode,
      minDurationSec: extra.minDurationSec,
      maxDurationSec: extra.maxDurationSec,
    });
    if (!dur.ok) {
      setErrorMsg(dur.message);
      return;
    }
    setStatus("previewing");
    setPreviewBusy(true);
    setErrorMsg(null);
    setFetchHint(null);
    setOutputUrl(null);
    setShotPreview(null);
    setJobId(null);

    try {
      const res = await fetch("/api/text-video-jobs/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: voScript,
          hookStyle,
          variationCount: extra.variationCount,
          clipLengthMode: extra.clipLengthMode,
          minDurationSec: extra.minDurationSec,
          maxDurationSec: extra.maxDurationSec,
        }),
      });
      const data = (await res.json()) as {
        shots?: TextVideoShotPreview[];
        message?: string;
        error?: string;
      };

      if (!res.ok) {
        setStatus("failed");
        setErrorMsg(
          `${data.message ?? data.error ?? `Preview failed (${res.status})`} No credits were charged. Try again.`,
        );
        return;
      }

      const shots = data.shots;
      if (!Array.isArray(shots) || shots.length < 3) {
        setStatus("failed");
        setErrorMsg(
          "Could not plan shots. No credits were charged. Try again.",
        );
        return;
      }

      setShotPreview(
        shots.map((s) => ({
          keyword: String(s.keyword ?? ""),
          duration: Math.min(
            12,
            Math.max(2, Math.round(Number(s.duration) || 5)),
          ),
          caption: String(s.caption ?? ""),
        })),
      );
    } catch {
      setStatus("failed");
      setErrorMsg("Connection issue. No credits were charged. Try again.");
    } finally {
      setPreviewBusy(false);
    }
  };

  const confirmAndGenerate = async () => {
    if (!shotPreview?.length) return;
    setStatus("queued");
    setErrorMsg(null);
    setFetchHint(null);
    setOutputUrl(null);

    try {
      const extra = buildPlannerBody();
      const res = await fetch("/api/text-video-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: voScript,
          generationId,
          voiceId,
          hookStyle,
          shotPlan: shotPreview,
          variationCount: extra.variationCount,
          clipLengthMode: extra.clipLengthMode,
          minDurationSec: extra.minDurationSec,
          maxDurationSec: extra.maxDurationSec,
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
          `${data.message ?? data.error ?? `Failed to start (${res.status})`} No credits were charged. Try again.`,
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
      setErrorMsg("Connection issue. No credits were charged. Try again.");
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

      if (next === "fetching" && job.error_message) {
        setFetchHint(job.error_message);
      } else if (next !== "fetching") {
        setFetchHint(null);
      }

      if (next === "complete" && job.output_url) {
        setFetchHint(null);
        setOutputUrl(job.output_url);
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
      if (next === "failed") {
        setFetchHint(null);
        setErrorMsg(job.error_message ?? job.error ?? "Something went wrong.");
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

  useEffect(() => {
    if (isRunning) {
      setElapsed(0);
      elapsedRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else if (elapsedRef.current) {
      clearInterval(elapsedRef.current);
    }
    return () => {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, [isRunning]);

  const runningProgress =
    status === "queued"
      ? 12
      : status === "planning"
        ? 35
        : status === "fetching"
          ? 55
          : status === "assembling"
            ? 75
            : status === "uploading"
              ? 92
              : 0;

  const shell = kit
    ? "rounded-xl border border-white/14 bg-white/[0.06] text-white outline outline-1 -outline-offset-1 outline-white/10 backdrop-blur-sm"
    : "rounded-xl border border-ada-border bg-ada-card text-ada-primary";

  const voiceSelectClass = cn(
    "max-w-[140px] shrink-0 truncate rounded-md border py-1.5 pl-2 pr-7 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[#8800DC]/40 disabled:opacity-40",
    kit
      ? "border-white/20 bg-white/5 text-white"
      : "border-ada-border bg-ada-input text-ada-primary",
  );

  return (
    <div className={cn("overflow-hidden", shell)}>
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3",
          kit ? "border-white/12" : "border-ada-border",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
              kit
                ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)]"
                : "bg-linear-to-br from-[#7B5CFA] to-[#9B6FFF]",
            )}
          >
            <Video className="h-3.5 w-3.5 text-white" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3
              className={cn(
                "truncate text-sm font-semibold leading-tight",
                kit &&
                  "font-[family-name:var(--font-instrument-serif)] font-normal tracking-[0.2px]",
              )}
            >
              {kit ? "Script to video" : "Video from script"}
            </h3>
            <p
              className={cn(
                "text-[11px] leading-tight",
                kit ? "text-white/45" : "text-ada-disabled",
              )}
            >
              {kit
                ? "5 credits · ~1–2 min · choose how many scene options"
                : "Stock footage, voice, captions · 5 credits · flexible length"}
            </p>
          </div>
        </div>
        {(status === "idle" || status === "previewing") && (
          <label className="flex items-center gap-1.5 text-[11px]">
            <span className={cn("shrink-0", kit ? "text-white/40" : "text-ada-disabled")}>
              Voice
            </span>
            <select
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              className={voiceSelectClass}
              aria-label="Narration voice"
              disabled={previewBusy}
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="space-y-3 p-4">
        {status === "idle" ? (
          <div className="space-y-2">
            {errorMsg ? (
              <p
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-xs",
                  kit
                    ? "border-amber-400/30 bg-amber-950/25 text-amber-100"
                    : "border-ada-border bg-ada-elevated text-ada-secondary",
                )}
              >
                {errorMsg}
              </p>
            ) : null}
            <details
              className={cn(
                "rounded-lg border px-2.5 py-2 text-left text-xs",
                kit ? "border-white/12 bg-white/[0.04]" : "border-ada-border bg-ada-elevated/40",
              )}
            >
              <summary
                className={cn(
                  "cursor-pointer select-none font-medium",
                  kit ? "text-white/75" : "text-ada-secondary",
                )}
              >
                Advanced
              </summary>
              <div className="mt-2 space-y-3">
                <div>
                  <Label
                    className={cn(
                      "text-[10px]",
                      kit ? "text-white/45" : "text-ada-disabled",
                    )}
                  >
                    Scene options (guidance)
                  </Label>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(["1", "2", "3", "5"] as const).map((n) => (
                      <Button
                        key={n}
                        type="button"
                        size="sm"
                        variant={variationPreset === n ? "default" : "outline"}
                        className="h-7 rounded-full px-2.5 text-[11px]"
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
                      className="h-7 rounded-full px-2.5 text-[11px]"
                      onClick={() => setVariationPreset("custom")}
                    >
                      Custom
                    </Button>
                    {variationPreset === "custom" ? (
                      <input
                        type="number"
                        min={1}
                        max={12}
                        aria-label="Custom scene option count"
                        className={cn(
                          "h-7 w-14 rounded-md border px-1 text-center text-[11px] outline-none",
                          kit
                            ? "border-white/20 bg-white/5 text-white"
                            : "border-ada-border bg-ada-input text-ada-primary",
                        )}
                        value={variationCustomStr}
                        onChange={(e) => setVariationCustomStr(e.target.value)}
                      />
                    ) : null}
                  </div>
                </div>
                <div>
                  <Label
                    className={cn(
                      "text-[10px]",
                      kit ? "text-white/45" : "text-ada-disabled",
                    )}
                  >
                    Target runtime (optional)
                  </Label>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={clipLengthMode === "auto" ? "default" : "outline"}
                      className="h-7 rounded-full px-2.5 text-[11px]"
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
                      className="h-7 rounded-full px-2.5 text-[11px]"
                      onClick={() => setClipLengthMode("custom")}
                    >
                      Custom
                    </Button>
                  </div>
                  {clipLengthMode === "custom" ? (
                    <div className="mt-1.5 flex gap-2">
                      <input
                        type="number"
                        min={1}
                        placeholder="Min s"
                        className={cn(
                          "h-7 w-20 rounded-md border px-1.5 text-[11px] outline-none",
                          kit
                            ? "border-white/20 bg-white/5 text-white placeholder:text-white/35"
                            : "border-ada-border bg-ada-input text-ada-primary",
                        )}
                        value={minDurationStr}
                        onChange={(e) => setMinDurationStr(e.target.value)}
                      />
                      <input
                        type="number"
                        min={1}
                        placeholder="Max s"
                        className={cn(
                          "h-7 w-20 rounded-md border px-1.5 text-[11px] outline-none",
                          kit
                            ? "border-white/20 bg-white/5 text-white placeholder:text-white/35"
                            : "border-ada-border bg-ada-input text-ada-primary",
                        )}
                        value={maxDurationStr}
                        onChange={(e) => setMaxDurationStr(e.target.value)}
                      />
                    </div>
                  ) : null}
                  <p
                    className={cn(
                      "mt-1.5 text-[10px] leading-snug",
                      kit ? "text-white/40" : "text-ada-disabled",
                    )}
                  >
                    Longer totals may take more time to generate.
                  </p>
                </div>
              </div>
            </details>
            <button
              type="button"
              onClick={() => void requestPreview()}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-92 active:scale-[0.99]",
                kit
                  ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)]"
                  : "bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF]",
              )}
            >
              <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
              Preview plan
            </button>
          </div>
        ) : null}

        {status === "previewing" ? (
          <div className="space-y-2">
            {previewBusy || !shotPreview ? (
              <p
                className={cn(
                  "animate-pulse text-sm font-medium",
                  kit ? "text-white" : "text-ada-primary",
                )}
              >
                Planning your shots…
              </p>
            ) : (
              <>
                {errorMsg ? (
                  <p
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs",
                      kit
                        ? "border-amber-400/30 bg-amber-950/25 text-amber-100"
                        : "border-ada-error/25 bg-ada-error/10 text-ada-error",
                    )}
                  >
                    {errorMsg}
                  </p>
                ) : null}
                <p
                  className={cn(
                    "text-xs font-medium",
                    kit ? "text-white/70" : "text-ada-secondary",
                  )}
                >
                  {shotPreview.length} scenes · {totalPreviewDuration}s
                </p>
                <ul
                  className={cn(
                    "divide-y overflow-hidden rounded-lg border",
                    kit ? "divide-white/10 border-white/12" : "divide-ada-border border-ada-border",
                  )}
                >
                  {shotPreview.map((shot, i) => (
                    <li
                      key={i}
                      className={cn(
                        "flex flex-col gap-1.5 p-2.5 sm:flex-row sm:items-start sm:gap-2",
                        kit ? "bg-white/[0.03]" : "bg-ada-elevated/40",
                      )}
                    >
                      <span
                        className={cn(
                          "w-6 shrink-0 text-center text-[11px] font-bold tabular-nums sm:pt-1",
                          kit ? "text-[#D31CD7]" : "text-ada-accent",
                        )}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <input
                          type="text"
                          value={shot.keyword}
                          onChange={(e) =>
                            updateShotPreview(i, { keyword: e.target.value })
                          }
                          className={cn(
                            "w-full rounded border px-2 py-1 text-xs outline-none",
                            kit
                              ? "border-white/15 bg-white/5 text-white placeholder:text-white/35"
                              : "border-ada-border bg-ada-input text-ada-primary",
                          )}
                          placeholder="Search terms for footage"
                          aria-label={`Scene ${i + 1} footage search`}
                        />
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={shot.caption}
                            onChange={(e) =>
                              updateShotPreview(i, { caption: e.target.value })
                            }
                            className={cn(
                              "min-w-0 flex-1 rounded border px-2 py-1 text-[11px] outline-none",
                              kit
                                ? "border-white/15 bg-white/5 text-white/95"
                                : "border-ada-border bg-ada-input text-ada-primary",
                            )}
                            placeholder="On-screen line"
                            aria-label={`Scene ${i + 1} line`}
                          />
                          <input
                            type="number"
                            min={2}
                            max={12}
                            value={shot.duration}
                            onChange={(e) =>
                              updateShotPreview(i, {
                                duration: Number(e.target.value),
                              })
                            }
                            className={cn(
                              "w-12 shrink-0 rounded border px-1 py-1 text-center text-[11px] outline-none",
                              kit
                                ? "border-white/15 bg-white/5 text-white/95"
                                : "border-ada-border bg-ada-input text-ada-primary",
                            )}
                            aria-label={`Scene ${i + 1} seconds`}
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => void confirmAndGenerate()}
                  disabled={totalPreviewDuration < 8 || totalPreviewDuration > 200}
                  className={cn(
                    "w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-92 disabled:pointer-events-none disabled:opacity-35",
                    kit
                      ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)]"
                      : "bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF]",
                  )}
                >
                  Generate · 5 credits
                </button>
                {totalPreviewDuration < 8 || totalPreviewDuration > 200 ? (
                  <p
                    className={cn(
                      "text-center text-[11px]",
                      kit ? "text-amber-200/85" : "text-ada-error",
                    )}
                  >
                    Unusual total length ({totalPreviewDuration}s). Adjust scene
                    seconds or regenerate.
                  </p>
                ) : totalPreviewDuration > 90 ? (
                  <p
                    className={cn(
                      "text-center text-[11px]",
                      kit ? "text-amber-200/80" : "text-ada-secondary",
                    )}
                  >
                    Longer videos may take more time to generate.
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setStatus("idle");
                    setShotPreview(null);
                    setErrorMsg(null);
                    setFetchHint(null);
                  }}
                  className={cn(
                    "w-full py-1 text-center text-[11px] font-medium transition-colors",
                    kit
                      ? "text-white/55 hover:text-white/80"
                      : "text-ada-secondary hover:text-ada-primary",
                  )}
                >
                  Start over
                </button>
              </>
            )}
          </div>
        ) : null}

        {isRunning ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p
                className={cn(
                  "min-w-0 text-sm font-medium",
                  kit ? "text-white" : "text-ada-primary",
                )}
              >
                {runningHeadline(status)}
              </p>
              <span
                className={cn(
                  "shrink-0 text-xs tabular-nums",
                  kit ? "text-white/40" : "text-ada-disabled",
                )}
              >
                {formatElapsed(elapsed)}
              </span>
            </div>

            <div
              className={cn(
                "h-1.5 overflow-hidden rounded-full",
                kit ? "bg-white/10" : "bg-ada-border",
              )}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700 ease-out",
                  kit ? "bg-[#D31CD7]" : "bg-ada-accent",
                )}
                style={{ width: `${runningProgress}%` }}
              />
            </div>

            {status === "fetching" && fetchHint ? (
              <p
                className={cn(
                  "text-[11px]",
                  kit ? "text-white/45" : "text-ada-disabled",
                )}
              >
                {fetchHint}
              </p>
            ) : null}

            {status === "fetching" && !fetchHint ? (
              <p
                className={cn(
                  "text-[11px]",
                  kit ? "text-white/35" : "text-ada-disabled",
                )}
              >
                Searching Pexels for matching footage…
              </p>
            ) : null}

            {elapsed > 90 ? (
              <p
                className={cn(
                  "text-[11px]",
                  kit ? "text-amber-200/70" : "text-ada-disabled",
                )}
              >
                Taking longer than usual — still going…
              </p>
            ) : null}
          </div>
        ) : null}

        {status === "complete" && outputUrl ? (
          <div className="space-y-3">
            <div className="mx-auto w-[min(100%,220px)]">
              <LazyVideoPlayer
                src={outputUrl}
                className="aspect-9/16 w-full overflow-hidden rounded-xl shadow-lg"
                autoPlay
                loop
                muted={false}
              />
            </div>

            <p
              className={cn(
                "text-center text-[10px]",
                kit ? "text-white/35" : "text-ada-disabled",
              )}
            >
              9:16 · 1080×1920 · Ready for TikTok, Reels & Shorts
            </p>

            <div className="grid grid-cols-3 gap-1.5">
              <a
                href={outputUrl}
                download="genex-video.mp4"
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border py-2.5 text-[11px] font-medium transition-colors",
                  kit
                    ? "border-white/25 text-white/85 hover:bg-white/10"
                    : "border-ada-border text-ada-secondary hover:border-ada-border-active",
                )}
              >
                <span>⬇</span> Download
              </a>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(outputUrl)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border py-2.5 text-[11px] font-medium transition-colors",
                  kit
                    ? "border-white/25 text-white/85 hover:bg-white/10"
                    : "border-ada-border text-ada-secondary hover:border-ada-border-active",
                )}
              >
                <span>🔗</span> Copy link
              </button>
              <button
                type="button"
                onClick={() => {
                  setStatus("idle");
                  setOutputUrl(null);
                  setJobId(null);
                  setShotPreview(null);
                  setFetchHint(null);
                }}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border py-2.5 text-[11px] font-medium transition-colors",
                  kit
                    ? "border-white/25 text-white/85 hover:bg-white/10"
                    : "border-ada-border text-ada-secondary hover:border-ada-border-active",
                )}
              >
                <span>↺</span> Redo
              </button>
            </div>
          </div>
        ) : null}

        {status === "failed" ? (
          <div className="space-y-2">
            <p
              className={cn(
                "rounded-md border px-2.5 py-2 text-sm",
                kit
                  ? "border-red-400/35 bg-red-950/35 text-red-100"
                  : "border-ada-error/25 bg-ada-error/10 text-ada-error",
              )}
            >
              {errorMsg ?? "Something went wrong."}
            </p>
            <button
              type="button"
              onClick={() => {
                setStatus("idle");
                setErrorMsg(null);
                setJobId(null);
                setShotPreview(null);
                setFetchHint(null);
              }}
              className={cn(
                "w-full rounded-lg border py-2 text-xs font-medium transition-colors",
                kit
                  ? "border-white/25 text-white/85 hover:bg-white/10"
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
