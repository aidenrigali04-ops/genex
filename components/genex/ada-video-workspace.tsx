"use client";

import type { JSX, ReactNode } from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  Check,
  Clock,
  Copy,
  Crown,
  Download,
  Image,
  Info,
  Loader2,
  Menu,
  MessageSquare,
  Mic,
  Music,
  Paperclip,
  Pause,
  Play,
  Scissors,
  Search,
  Settings,
  Sparkles,
  User,
  Video,
  Zap,
} from "lucide-react";

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

const MAIN_NAV = [
  { id: "search" as const, label: "Search", Icon: Search },
  { id: "chat" as const, label: "AI Chat", Icon: MessageSquare },
  { id: "voice" as const, label: "Voiceover", Icon: Mic },
  { id: "image" as const, label: "Image", Icon: Image },
  { id: "video" as const, label: "Video", Icon: Video },
  { id: "music" as const, label: "Music", Icon: Music },
];

const BOTTOM_NAV = [
  { id: "upgrade" as const, label: "Upgrade plan", Icon: Crown },
  { id: "settings" as const, label: "Settings", Icon: Settings },
  { id: "account" as const, label: "My account", Icon: User },
] as const;

export type AdaVideoShellNavId =
  | (typeof MAIN_NAV)[number]["id"]
  | (typeof BOTTOM_NAV)[number]["id"];

export type AdaVideoWorkspaceProps = {
  userId: string | null;
  creditsRemaining: number;
  creditsUnlimited: boolean;
  onCreditChange?: (remaining: number) => void;
  onJobFinished?: () => void;
  onUpgrade?: () => void;
  /** Credits pill + account menu rendered in the workspace header (adaKit). */
  headerTrailing?: ReactNode;
  /** Leave video workspace when user picks a non-video shell nav item. */
  onSidebarNavigate?: (id: AdaVideoShellNavId) => void;
  onWorkspaceSettings?: () => void;
  onWorkspaceAccount?: () => void;
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

const STEP_HINTS = [
  { status: "planning", label: "Planning shots" },
  { status: "fetching", label: "Finding B-roll" },
  { status: "assembling", label: "Assembling" },
  { status: "uploading", label: "Uploading" },
] as const;

const POLL_MS = 3000;
const SCRIPT_MIN_LEN = 20;

const EXAMPLE_PROMPTS = [
  {
    id: "1",
    prompt: "Clip the best moments from this podcast episode",
    thumb:
      "linear-gradient(145deg, #1a0a2e 0%, #3d2060 40%, #6b2d7a 100%), linear-gradient(220deg, rgba(211,28,215,0.35) 0%, transparent 55%)",
  },
  {
    id: "2",
    prompt: "Find the viral-worthy moments from this long video",
    thumb:
      "linear-gradient(145deg, #0f1729 0%, #1e3a5f 45%, #2d4a7c 100%), linear-gradient(160deg, rgba(136,0,220,0.3) 0%, transparent 50%)",
  },
  {
    id: "3",
    prompt: "Extract all the hooks from this YouTube video",
    thumb:
      "linear-gradient(145deg, #1a1030 0%, #4a1e5c 50%, #7a2d6a 100%), linear-gradient(200deg, rgba(255,200,100,0.2) 0%, transparent 45%)",
  },
  {
    id: "4",
    prompt: "Turn this interview into short-form clips",
    thumb:
      "linear-gradient(145deg, #0d2818 0%, #1a4d32 50%, #2d6a45 100%), linear-gradient(180deg, rgba(100,200,120,0.25) 0%, transparent 55%)",
  },
] as const;

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

function ElapsedTimer({ startedAt }: { startedAt: string }): JSX.Element {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <span className="font-mono text-[12px] text-white/40" suppressHydrationWarning>
      {m}:{String(s).padStart(2, "0")}
    </span>
  );
}

type AdaVideoSidebarProps = {
  activeTab: AdaVideoShellNavId;
  onTabChange: (id: AdaVideoShellNavId) => void;
  onUpgrade?: () => void;
  onSettings?: () => void;
  onAccount?: () => void;
  className?: string;
};

function AdaVideoSidebar({
  activeTab,
  onTabChange,
  onUpgrade,
  onSettings,
  onAccount,
  className,
}: AdaVideoSidebarProps): JSX.Element {
  return (
    <aside
      className={cn(
        "relative flex h-full w-[280px] shrink-0 flex-col border-r border-white bg-[rgba(198,108,255,0.08)]",
        className,
      )}
    >
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)]">
            <Sparkles className="size-5 text-white" aria-hidden />
          </div>
          <span className="font-[family-name:var(--font-instrument-serif)] text-[36px] font-normal leading-[48px] tracking-[0.36px] text-white">
            GenEx
          </span>
        </div>
        <div className="flex items-center gap-0.5 opacity-60" aria-hidden>
          <div className="flex size-4 items-center justify-center text-white">
            <span className="block h-2 w-1 bg-white" />
          </div>
          <div className="flex size-5 items-center justify-center rounded border border-white/80" />
        </div>
      </div>

      <nav
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto py-5"
        aria-label="Main navigation"
      >
        <ul className="flex flex-col gap-3 px-3">
          {MAIN_NAV.map((item) => {
            const active = activeTab === item.id;
            const Icon = item.Icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[32px] px-4 py-1 text-left text-base font-normal leading-[36px] text-white transition-all",
                    active
                      ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] shadow-[0_0_20px_rgba(203,45,206,0.24)]"
                      : "hover:bg-white/8",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mx-3 border-t border-white" aria-hidden />

        <ul className="flex flex-col gap-3 px-3">
          {BOTTOM_NAV.map((item) => {
            const Icon = item.Icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (item.id === "upgrade") {
                      onUpgrade?.();
                      return;
                    }
                    if (item.id === "settings") {
                      onSettings?.();
                      return;
                    }
                    if (item.id === "account") {
                      onAccount?.();
                    }
                  }}
                  className="flex w-full items-center gap-3 rounded-[32px] px-4 py-1 text-left text-base font-normal leading-[36px] text-white transition-all hover:bg-white/8"
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

type AdaVideoHeaderProps = {
  onRecentClick: () => void;
  headerTrailing?: ReactNode;
  onMenuClick?: () => void;
};

function AdaVideoHeader({
  onRecentClick,
  headerTrailing,
  onMenuClick,
}: AdaVideoHeaderProps): JSX.Element {
  return (
    <header className="flex h-[80px] shrink-0 items-center justify-between border-b border-white px-6 py-4">
      <div className="flex min-w-0 items-center gap-3">
        {onMenuClick ? (
          <button
            type="button"
            className="shrink-0 text-white/80 hover:text-white lg:hidden"
            aria-label="Open menu"
            onClick={onMenuClick}
          >
            <Menu className="size-6" aria-hidden />
          </button>
        ) : null}
        <h1 className="truncate font-[family-name:var(--font-instrument-serif)] text-[36px] font-normal tracking-[0.36px] text-white">
          Clip a Video
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onRecentClick}
          className="flex items-center gap-2 rounded-[32px] border border-white/48 px-3 py-2 text-[14px] font-medium leading-[24px] tracking-[0.14px] text-white transition-colors hover:bg-white/8"
        >
          <Clock className="h-5 w-5" aria-hidden />
          Recent
        </button>
        {headerTrailing}
      </div>
    </header>
  );
}

type AdaVideoInputBarProps = {
  inputMode: "url" | "text";
  urlValue: string;
  textValue: string;
  onUrlChange: (v: string) => void;
  onTextChange: (v: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  activeJob: string | null;
  creditsOk: boolean;
  creditCost: number;
  submitError: string | null;
  userId: string | null;
  onSurpriseMe: () => void;
  onUpgrade?: () => void;
};

function AdaVideoInputBar({
  inputMode,
  urlValue,
  textValue,
  onUrlChange,
  onTextChange,
  onSubmit,
  isSubmitting,
  activeJob,
  creditsOk,
  creditCost,
  submitError,
  userId,
  onSurpriseMe,
  onUpgrade,
}: AdaVideoInputBarProps): JSX.Element {
  const disabled =
    !userId ||
    isSubmitting ||
    activeJob !== null ||
    !creditsOk ||
    (inputMode === "url" ? !urlValue.trim() : textValue.trim().length < SCRIPT_MIN_LEN);

  return (
    <div className="w-full px-5 pb-5 pt-5 sm:px-[100px]">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 items-center gap-3 rounded-[22px] border border-white/16 bg-white/12 p-1.5">
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[22px] border border-white/32 text-white transition-colors hover:bg-white/10"
            aria-label="Attach file or YouTube URL"
          >
            <Paperclip className="h-4 w-4" aria-hidden />
          </button>
          <input
            type={inputMode === "url" ? "url" : "text"}
            value={inputMode === "url" ? urlValue : textValue}
            onChange={(e) =>
              inputMode === "url"
                ? onUrlChange(e.target.value)
                : onTextChange(e.target.value)
            }
            placeholder="Paste a YouTube URL or describe your video idea..."
            className="min-w-0 flex-1 bg-transparent text-[14px] font-normal leading-[20px] tracking-[0.14px] text-white outline-none placeholder:text-white/64"
          />
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled
              className="flex h-8 w-8 items-center justify-center rounded-[22px] border border-white/32 text-white opacity-50 transition-colors hover:bg-white/10"
              aria-label="Voice input (coming soon)"
            >
              <Mic className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void onSubmit()}
              className="flex h-8 w-8 items-center justify-center rounded-[32px] bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={isSubmitting || activeJob ? "Generating" : "Clip my video"}
            >
              {isSubmitting || activeJob ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ArrowUp className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onSurpriseMe}
          className="flex shrink-0 items-center gap-2 rounded-[32px] border border-white/48 px-3 py-[10px] text-[14px] font-medium leading-[24px] tracking-[0.14px] text-white transition-colors hover:bg-white/8"
        >
          <Sparkles className="h-5 w-5" aria-hidden />
          Surprise me
        </button>
      </div>

      <div className="mt-3 flex items-center justify-center gap-2">
        <Info className="h-4 w-4 shrink-0 text-white/64" aria-hidden />
        <p className="text-center text-[12px] font-normal leading-[24px] tracking-[0.12px] text-white/64">
          GenEx is beta release and may give incorrect or harmful info
        </p>
      </div>

      {!creditsOk ? (
        <p className="mt-2 text-center text-[11px] text-amber-300">
          Not enough credits —{" "}
          <button type="button" className="underline" onClick={() => onUpgrade?.()}>
            upgrade
          </button>
        </p>
      ) : (
        <p className="mt-2 text-center text-[12px] text-white/40">
          Uses {creditCost} credits per video
        </p>
      )}

      {submitError ? (
        <p className="mt-2 text-center text-xs text-[var(--ada-error)]" role="alert">
          {submitError}
          {submitError.toLowerCase().includes("credit") ? (
            <> — no credits were charged.</>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

type VideoClipCardProps = { job: VideoJob };

function VideoClipCard({ job }: VideoClipCardProps): JSX.Element {
  const [playing, setPlaying] = useState(false);
  const [hovered, setHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const st = job.status;
  const complete = st === "complete" && !!job.output_url;
  const statusIdx = stepOrderIndex(st);

  const handlePlayToggle = (): void => {
    if (!videoRef.current || !complete) return;
    if (playing) {
      videoRef.current.pause();
      setPlaying(false);
    } else {
      void videoRef.current.play();
      setPlaying(true);
    }
  };

  const handleCopyLink = (): void => {
    if (!job.output_url) return;
    void navigator.clipboard.writeText(job.output_url).catch(() => {});
  };

  return (
    <div
      className="group flex flex-col overflow-hidden rounded-2xl border border-white/12 bg-white/8 transition-all duration-200 hover:border-white/24 hover:bg-white/12"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="relative aspect-[9/16] w-full overflow-hidden bg-[#180532]">
        {complete ? (
          <>
            <video
              ref={videoRef}
              src={job.output_url!}
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
              className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/25"
              aria-label={playing ? "Pause clip" : "Play clip"}
            >
              <div
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-lg transition-all duration-200",
                  playing || hovered ? "scale-100 opacity-100" : "scale-90 opacity-0 md:group-hover:scale-100 md:group-hover:opacity-100",
                )}
              >
                {playing ? (
                  <Pause className="h-5 w-5 text-[#7B5CFA]" aria-hidden />
                ) : (
                  <Play className="ml-0.5 h-5 w-5 text-[#7B5CFA]" aria-hidden />
                )}
              </div>
            </button>
            <div className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
              0:45
            </div>
            <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] px-2 py-0.5 text-[11px] font-semibold text-white shadow-md">
              <Zap className="h-3 w-3" aria-hidden />
              94%
            </div>
          </>
        ) : st === "failed" || st === "cancelled" ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <AlertCircle className="h-8 w-8 text-white/30" aria-hidden />
              <p className="text-[12px] capitalize text-white/40">{st}</p>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-linear-to-b from-[#180532] to-[#0A050F]">
            <div className="relative">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-[#D31CD7]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Video className="h-4 w-4 text-white/40" aria-hidden />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {STEP_HINTS.map((hint) => {
                const hIdx = stepOrderIndex(hint.status);
                const done = statusIdx >= 0 && hIdx >= 0 && hIdx < statusIdx;
                const active = hint.status === st;
                return (
                  <div
                    key={hint.status}
                    className={cn(
                      "h-1.5 w-1.5 rounded-full transition-all",
                      done ? "bg-[#D31CD7]" : active ? "animate-pulse bg-[#8800DC]" : "bg-white/20",
                    )}
                  />
                );
              })}
            </div>
            <p className="text-[12px] font-medium text-white/60">
              {STATUS_MAP[st]?.label ?? "Processing…"}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-3">
        <p className="line-clamp-2 text-[13px] font-medium leading-[20px] tracking-[0.13px] text-white/80">
          {job.script || "Processing your clip…"}
        </p>

        <div className="flex items-center justify-between">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
              st === "complete"
                ? "bg-emerald-500/15 text-emerald-400"
                : st === "failed"
                  ? "bg-red-500/15 text-red-400"
                  : st === "cancelled"
                    ? "bg-white/10 text-white/40"
                    : "bg-[#D31CD7]/15 text-[#D31CD7]",
            )}
          >
            {st}
          </span>
          <span className="text-[11px] text-white/40" suppressHydrationWarning>
            {relativeFromNow(job.created_at)}
          </span>
        </div>

        {complete ? (
          <div className="flex gap-2 pt-1">
            <a
              href={job.output_url!}
              download
              target="_blank"
              rel="noreferrer"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-[32px] border border-white/20 py-1.5 text-[12px] font-medium text-white/70 transition-colors hover:border-white/40 hover:text-white"
              aria-label="Download this clip"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Download
            </a>
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex items-center justify-center rounded-[32px] border border-white/20 px-3 py-1.5 text-[12px] font-medium text-white/70 transition-colors hover:border-white/40 hover:text-white"
              aria-label="Copy video link"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : st === "failed" ? (
          <p className="text-[11px] text-white/30">No credits were charged.</p>
        ) : null}
      </div>
    </div>
  );
}

export function AdaVideoWorkspace({
  userId,
  creditsRemaining,
  creditsUnlimited,
  onCreditChange,
  onJobFinished,
  onUpgrade,
  headerTrailing,
  onSidebarNavigate,
  onWorkspaceSettings,
  onWorkspaceAccount,
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
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);

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

  const handleSurpriseMe = useCallback((): void => {
    const pick = EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)];
    if (!pick) return;
    setInputMode("text");
    setTextValue(pick.prompt);
  }, []);

  const handleShellNav = useCallback(
    (id: AdaVideoShellNavId): void => {
      if (id === "video") return;
      if (id === "upgrade" || id === "settings" || id === "account") return;
      onSidebarNavigate?.(id);
    },
    [onSidebarNavigate],
  );

  const statusKey = activeJobData?.status ?? "queued";
  const statusInfo = STATUS_MAP[statusKey] ?? STATUS_MAP.queued;
  const progressPct = statusInfo.pct;
  const progressHint =
    statusKey === "fetching" && activeJobData?.error_message?.trim()
      ? activeJobData.error_message.trim()
      : null;

  const statusIdx = stepOrderIndex(statusKey);

  const emptyStateA =
    !activeJob &&
    jobHistory.length === 0 &&
    !loadingHistory;

  const resultsStateB =
    activeJob !== null || jobHistory.length > 0;

  const sidebarProps: AdaVideoSidebarProps = {
    activeTab: "video",
    onTabChange: (id) => {
      handleShellNav(id);
      setShellMenuOpen(false);
    },
    onUpgrade,
    onSettings: onWorkspaceSettings,
    onAccount: onWorkspaceAccount,
  };

  const inputBarProps: AdaVideoInputBarProps = {
    inputMode,
    urlValue,
    textValue,
    onUrlChange: setUrlValue,
    onTextChange: setTextValue,
    onSubmit: handleGenerate,
    isSubmitting,
    activeJob,
    creditsOk,
    creditCost,
    submitError,
    userId,
    onSurpriseMe: handleSurpriseMe,
    onUpgrade,
  };

  if (!kit) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-ada-app text-ada-primary">
        <div className="mx-auto grid h-full w-full max-w-5xl grid-cols-1 gap-6 overflow-hidden px-4 py-6 lg:grid-cols-[380px_1fr]">
          <div className="flex min-h-0 flex-col gap-4 lg:overflow-y-auto lg:pb-8">
            <div className="space-y-4 rounded-2xl border border-ada-border bg-ada-card p-5">
              <p className="text-sm font-semibold text-ada-primary">Got a video idea?</p>
              <div className="flex gap-1 rounded-full border border-ada-border bg-ada-app p-0.5" role="tablist" aria-label="Input source">
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
                  className="w-full rounded-xl border border-ada-border bg-ada-input px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ada-accent"
                />
              ) : (
                <textarea
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  placeholder="Describe your idea…"
                  rows={3}
                  className="w-full resize-none rounded-xl border border-ada-border bg-ada-input px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ada-accent"
                />
              )}
            </div>
            <div className="rounded-2xl border border-ada-border bg-ada-card p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-ada-disabled">Voice</p>
              <div className="grid grid-cols-2 gap-2">
                {VOICE_OPTIONS.map((v) => {
                  const sel = selectedVoice === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVoice(v.id)}
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-left text-xs transition-colors",
                        sel ? "border-ada-accent bg-ada-accent-subtle" : "border-ada-border hover:border-ada-border-active",
                      )}
                    >
                      <span className="font-semibold">{v.label}</span>
                      <p className="mt-0.5 text-[10px] text-ada-disabled">{v.desc}</p>
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
                className="flex w-full items-center justify-center gap-2 rounded-full bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF] py-3.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {isSubmitting || activeJob ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Scissors className="size-4" aria-hidden />
                )}
                Clip my video
              </button>
              {!creditsOk ? (
                <p className="text-center text-[11px] text-amber-600 dark:text-amber-300">
                  Not enough credits —{" "}
                  <button type="button" className="underline" onClick={() => onUpgrade?.()}>
                    upgrade
                  </button>
                </p>
              ) : (
                <p className="text-center text-[10px] text-ada-disabled">Uses {creditCost} credits per video</p>
              )}
              {submitError ? (
                <p className="text-center text-xs text-[var(--ada-error)]" role="alert">
                  {submitError}
                  {submitError.toLowerCase().includes("credit") ? <> — no credits were charged.</> : null}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-8">
            {activeJob && activeJobData ? (
              <div className="rounded-2xl border border-ada-border bg-ada-card p-4">
                <p className="text-sm font-medium">{statusInfo.label}</p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ada-border">
                  <div
                    className="h-full rounded-full bg-linear-to-r from-[#7B5CFA] to-[#9B6FFF] transition-all duration-700"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <button type="button" className="mt-2 text-xs text-ada-disabled hover:text-[var(--ada-error)]" onClick={() => void handleCancel()}>
                  Cancel
                </button>
              </div>
            ) : null}
            {loadingHistory ? (
              <Loader2 className="mx-auto size-8 animate-spin text-ada-accent" aria-hidden />
            ) : (
              <ul className="flex flex-col gap-4">
                {jobHistory.map((job) => (
                  <li key={job.id}>
                    <VideoClipCardDefault job={job} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-[#0A050F] font-[family-name:var(--font-instrument-sans)] text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute"
          style={{
            width: "1322px",
            height: "797px",
            left: "453px",
            top: "-127px",
            transform: "rotate(-13deg)",
            background: "#180532",
            filter: "blur(300px)",
          }}
        />
        <div
          className="absolute"
          style={{
            width: "2048px",
            height: "1481px",
            left: "2479px",
            top: "950px",
            transform: "rotate(148deg)",
            background: "#300537",
            filter: "blur(300px)",
          }}
        />
        <div
          className="absolute"
          style={{
            width: "3212px",
            height: "1160px",
            left: "-1159px",
            top: "1236px",
            transform: "rotate(-57deg)",
            background: "#230639",
            filter: "blur(300px)",
          }}
        />
      </div>

      {shellMenuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close menu"
            onClick={() => setShellMenuOpen(false)}
          />
          <AdaVideoSidebar
            {...sidebarProps}
            className="absolute left-0 top-0 z-[1] h-full shadow-2xl"
          />
        </div>
      ) : null}

      <AdaVideoSidebar {...sidebarProps} className="relative z-[1] hidden lg:flex" />

      <div className="relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AdaVideoHeader
          onRecentClick={() => setRecentOpen((o) => !o)}
          headerTrailing={headerTrailing}
          onMenuClick={() => setShellMenuOpen(true)}
        />

        {recentOpen ? (
          <div className="absolute right-6 top-[88px] z-20 max-h-72 w-72 overflow-y-auto rounded-2xl border border-white/16 bg-[#0A050F]/95 p-2 shadow-xl backdrop-blur-md">
            {jobHistory.length === 0 ? (
              <p className="px-2 py-3 text-sm text-white/50">No clips yet.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {jobHistory.map((j) => (
                  <li key={j.id}>
                    <button
                      type="button"
                      className="w-full truncate rounded-lg px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10"
                      onClick={() => setRecentOpen(false)}
                    >
                      {j.script.slice(0, 80)}
                      {j.script.length > 80 ? "…" : ""}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {loadingHistory && !resultsStateB ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="size-10 animate-spin text-white/40" aria-hidden />
            </div>
          ) : emptyStateA ? (
            <div className="flex flex-1 flex-col items-center justify-between overflow-hidden px-6 sm:px-[120px]">
              <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8">
                <div className="relative flex h-[120px] w-[120px] items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-[#3600AA] opacity-80 blur-[25px]" />
                  <div className="absolute h-[100px] w-[115px] rotate-[60deg] rounded-full bg-[#6800BA] opacity-60 blur-[20px]" />
                  <div className="absolute h-[80px] w-[90px] -rotate-[66deg] rounded-full bg-[#A400A7] opacity-60 blur-[15px]" />
                  <div className="relative z-10 flex h-[80px] w-[80px] items-center justify-center rounded-full bg-white/12 shadow-[0_8px_20px_rgba(0,0,0,0.16)]">
                    <Sparkles className="size-8 rotate-[12deg] text-white" aria-hidden />
                  </div>
                </div>

                <h2 className="max-w-3xl text-center font-[family-name:var(--font-instrument-serif)] text-[36px] font-normal tracking-[0.36px] text-white">
                  Hi, How can I help you today?
                </h2>

                <div className="relative w-full max-w-full">
                  <div className="flex gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {EXAMPLE_PROMPTS.map((ex) => (
                      <button
                        key={ex.id}
                        type="button"
                        onClick={() => {
                          setInputMode("text");
                          setTextValue(ex.prompt);
                        }}
                        className="group relative h-[220px] w-[280px] shrink-0 overflow-hidden rounded-2xl border border-[rgba(10,5,15,0.16)]"
                        style={{
                          background: ex.thumb,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }}
                        aria-label={`Use prompt: ${ex.prompt}`}
                      >
                        <div className="pointer-events-none absolute inset-0 bg-black/10 transition-colors group-hover:bg-black/5" />
                        <div className="absolute inset-x-0 bottom-0 p-3">
                          <div className="rounded-xl bg-[rgba(10,5,15,0.16)] px-3 py-[10px] backdrop-blur-[50px]">
                            <p className="text-left text-[16px] font-medium leading-[24px] tracking-[0.16px] text-white">
                              {ex.prompt}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div
                    className="pointer-events-none absolute inset-y-0 left-0 z-[2] w-16 bg-linear-to-r from-[#21062A] to-transparent"
                    aria-hidden
                  />
                  <div
                    className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-16 bg-linear-to-l from-[#1D0625] to-transparent"
                    aria-hidden
                  />
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2">
                  {(["url", "text"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setInputMode(mode)}
                      className={cn(
                        "rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors",
                        inputMode === mode
                          ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white shadow-[0_0_16px_rgba(203,45,206,0.2)]"
                          : "border border-white/20 text-white/60 hover:bg-white/10",
                      )}
                    >
                      {mode === "url" ? "YouTube URL" : "My idea"}
                    </button>
                  ))}
                </div>
              </div>

              <AdaVideoInputBar {...inputBarProps} />
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden px-6 py-6 lg:grid-cols-[400px_1fr] lg:px-[120px]">
              <div className="flex min-h-0 flex-col gap-4 overflow-y-auto lg:sticky lg:top-0 lg:max-h-full lg:self-start">
                <div className="space-y-4 rounded-2xl border border-white/16 bg-white/12 p-5">
                  <p className="font-[family-name:var(--font-instrument-serif)] text-[18px] font-normal tracking-[0.36px] text-white">
                    Got a video idea?
                  </p>
                  <p className="text-[12px] font-normal leading-[24px] tracking-[0.12px] text-white/50">
                    Drop a YouTube URL or describe your idea — GenEx handles the rest.
                  </p>
                  <div className="flex gap-1 rounded-full border border-white/16 bg-white/12 p-1" role="tablist" aria-label="Input source">
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
                            ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white shadow-[0_0_12px_rgba(203,45,206,0.2)]"
                            : "text-white/55 hover:bg-white/10 hover:text-white/90",
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
                      className="w-full rounded-[22px] border border-white/16 bg-white/12 px-3 py-2.5 text-[14px] text-white outline-none placeholder:text-white/64 focus-visible:ring-2 focus-visible:ring-[#D31CD7]/40"
                    />
                  ) : (
                    <textarea
                      value={textValue}
                      onChange={(e) => setTextValue(e.target.value)}
                      placeholder="Describe your video idea…"
                      rows={3}
                      className="w-full resize-none rounded-[22px] border border-white/16 bg-white/12 px-3 py-2.5 text-[14px] text-white outline-none placeholder:text-white/64 focus-visible:ring-2 focus-visible:ring-[#D31CD7]/40"
                    />
                  )}
                </div>

                <div className="rounded-2xl border border-white/12 bg-white/8 p-4">
                  <p className="mb-3 text-[12px] font-normal uppercase leading-[24px] tracking-[0.12px] text-white/50">
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
                            "rounded-[32px] border px-3 py-2.5 text-left transition-all",
                            sel
                              ? "border-[#D31CD7]/60 bg-[linear-gradient(5deg,rgba(211,28,215,0.15)_0%,rgba(136,0,220,0.12)_100%)] shadow-[0_0_16px_rgba(203,45,206,0.15)]"
                              : "border-white/12 hover:border-white/24 hover:bg-white/6",
                          )}
                        >
                          <p className={cn("text-[13px] font-medium", sel ? "text-white" : "text-white/70")}>
                            {v.label}
                          </p>
                          <p className={cn("text-[11px]", sel ? "text-white/60" : "text-white/30")}>
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
                    className="flex w-full items-center justify-center gap-2 rounded-[32px] bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] py-3.5 text-[14px] font-medium leading-[24px] tracking-[0.14px] text-white shadow-[0_0_20px_rgba(203,45,206,0.24)] transition-all hover:shadow-[0_0_28px_rgba(203,45,206,0.36)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isSubmitting || activeJob ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        Clipping…
                      </>
                    ) : (
                      <>
                        <Scissors className="h-4 w-4" aria-hidden />
                        Clip my video
                      </>
                    )}
                  </button>
                  {!creditsOk ? (
                    <p className="text-center text-[11px] text-amber-300">
                      Not enough credits —{" "}
                      <button type="button" className="underline" onClick={() => onUpgrade?.()}>
                        upgrade
                      </button>
                    </p>
                  ) : (
                    <p className="text-center text-[12px] text-white/40">Uses {creditCost} credits per video</p>
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

              <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pb-8">
                {activeJob && activeJobData ? (
                  <div className="overflow-hidden rounded-2xl border border-[#D31CD7]/30 bg-[linear-gradient(135deg,rgba(211,28,215,0.08)_0%,rgba(136,0,220,0.06)_100%)] p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#D31CD7]" />
                        <span className="text-[14px] font-medium leading-[24px] text-white">
                          {statusInfo.label}
                        </span>
                        <ElapsedTimer startedAt={activeJobData.created_at} />
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCancel()}
                        className="rounded-[32px] border border-white/20 px-3 py-1 text-[12px] text-white/50 transition-colors hover:border-red-500/40 hover:text-red-400"
                        aria-label="Cancel video generation"
                      >
                        Cancel
                      </button>
                    </div>

                    <div className="mb-4 grid grid-cols-4 gap-2">
                      {STEP_HINTS.map((hint, i) => {
                        const hintIdx = stepOrderIndex(hint.status);
                        const done = statusIdx >= 0 && hintIdx >= 0 && hintIdx < statusIdx;
                        const active = hint.status === statusKey;
                        return (
                          <Fragment key={hint.status}>
                            <div className="flex flex-col items-center gap-1.5 text-center">
                              <div
                                className={cn(
                                  "flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-medium transition-all",
                                  done
                                    ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white"
                                    : active
                                      ? "animate-pulse border-2 border-[#D31CD7] text-[#D31CD7]"
                                      : "border border-white/20 text-white/30",
                                )}
                              >
                                {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                              </div>
                              <span
                                className={cn(
                                  "text-center text-[10px] font-medium leading-[16px] tracking-[0.1px]",
                                  done ? "text-[#D31CD7]" : active ? "text-white/80" : "text-white/25",
                                )}
                              >
                                {hint.label}
                              </span>
                            </div>
                          </Fragment>
                        );
                      })}
                    </div>

                    <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#D31CD7_0%,#8800DC_100%)] transition-all duration-700 ease-out"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>

                    {progressHint ? (
                      <p className="mt-2 text-[11px] italic text-white/40">{progressHint}</p>
                    ) : null}
                  </div>
                ) : null}

                {activeTerminalNote && !activeJob ? (
                  <div
                    className="rounded-2xl border border-white/16 bg-white/12 px-4 py-3 text-sm text-white/80"
                    role="status"
                  >
                    {activeTerminalNote}
                    {activeTerminalNote.toLowerCase().includes("fail") ? (
                      <span className="mt-1 block text-[10px] text-white/40">No credits were charged.</span>
                    ) : null}
                  </div>
                ) : null}

                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-white/40">Your clips</p>

                <div className="grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-4">
                  {jobHistory.map((job) => (
                    <VideoClipCard key={job.id} job={job} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VideoClipCardDefault({ job }: { job: VideoJob }): JSX.Element {
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

  return (
    <div className="overflow-hidden rounded-2xl border border-ada-border bg-ada-card">
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
                className="absolute inset-0 flex items-center justify-center hover:bg-black/20"
                aria-label={playing ? "Pause video" : "Play video"}
              >
                {!playing ? (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-md">
                    <Play className="ml-0.5 size-3.5 text-[#7B5CFA]" aria-hidden />
                  </div>
                ) : null}
              </button>
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-[#7B5CFA]/20 to-[#9B6FFF]/10">
              <Video className="size-5 text-ada-accent opacity-50" aria-hidden />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-xs text-ada-primary">{job.script}</p>
          <p className="mt-1 text-[10px] text-ada-disabled capitalize">{st}</p>
          {st === "failed" ? (
            <p className="mt-1 text-[10px] text-ada-disabled">No credits were charged.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
