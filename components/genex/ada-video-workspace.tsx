"use client";

import type { JSX, ReactNode } from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  Bird,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock,
  Copy,
  Download,
  Info,
  Link2,
  Loader2,
  Menu,
  Mic,
  Paperclip,
  Pause,
  Play,
  RefreshCw,
  Scissors,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  User,
  Video,
  Zap,
} from "lucide-react";

import { VideoVariationWorkspace } from "@/components/video-variation-workspace";
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

const VIDEO_WORKSPACE_NAV = [
  { id: "clip_my_video" as const, label: "Clip My Video", Icon: Video },
  {
    id: "stock_from_script" as const,
    label: "Stock video from script",
    Icon: Clapperboard,
  },
] as const;

export type AdaVideoShellNavId = (typeof VIDEO_WORKSPACE_NAV)[number]["id"];

export type AdaVideoWorkspaceProps = {
  userId: string | null;
  /** Session user for source clipping (`video_jobs`); prefer over `userId` alone. */
  authUser?: { id: string; email: string } | null;
  creditsRemaining: number;
  creditsUnlimited: boolean;
  onCreditChange?: (remaining: number) => void;
  onJobFinished?: () => void;
  onUpgrade?: () => void;
  onOpenSignIn?: () => void;
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
    prompt: "Gorgeous abandoned medieval mansion in a fairytale forest",
    thumb: "https://picsum.photos/seed/ada-mansion/280/220",
  },
  {
    id: "2",
    prompt: "Give me photo of a man working in an office in a big city.",
    thumb: "https://picsum.photos/seed/ada-office/280/220",
  },
  {
    id: "3",
    prompt: "Give me photo of a majestic peacock rising in the sky",
    thumb: "https://picsum.photos/seed/ada-peacock/280/220",
  },
  {
    id: "4",
    prompt: "Give me a nice scenery of a girl playing in a green field",
    thumb: "https://picsum.photos/seed/ada-field/280/220",
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
  className?: string;
};

function AdaVideoSidebar({
  activeTab,
  onTabChange,
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
            Ada
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
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-5"
        aria-label="Video workspace"
      >
        <ul className="flex flex-col gap-3 px-3">
          {VIDEO_WORKSPACE_NAV.map((item) => {
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
      </nav>
    </aside>
  );
}

type AdaVideoHeaderProps = {
  onRecentClick: () => void;
  headerTrailing?: ReactNode;
  onMenuClick?: () => void;
  /** Stock-from-script jobs list; hidden when primary mode is source clipping. */
  showRecent?: boolean;
};

function AdaVideoHeader({
  onRecentClick,
  headerTrailing,
  onMenuClick,
  showRecent = true,
}: AdaVideoHeaderProps): JSX.Element {
  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-white/[0.06] px-5 py-3">
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
        <h1 className="sr-only">Clip a video</h1>
        <div className="min-w-0 flex-1" aria-hidden />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {showRecent ? (
          <button
            type="button"
            onClick={onRecentClick}
            className="flex items-center gap-2 rounded-[32px] border border-white/48 px-3 py-2 text-[14px] font-medium leading-[24px] tracking-[0.14px] text-white transition-colors hover:bg-white/8"
          >
            <Clock className="h-5 w-5" aria-hidden />
            Recent
          </button>
        ) : null}
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
  /** Composer placeholder (ChatGPT-style follow-up copy). */
  composerPlaceholder?: string;
  /** After preflight staging, allow short follow-up (e.g. "skip"). */
  allowShortComposer?: boolean;
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
  composerPlaceholder = "Message Ada…",
  allowShortComposer = false,
}: AdaVideoInputBarProps): JSX.Element {
  const textOk =
    inputMode === "url"
      ? true
      : allowShortComposer
        ? textValue.trim().length >= 2
        : textValue.trim().length >= SCRIPT_MIN_LEN;
  const disabled =
    !userId ||
    isSubmitting ||
    activeJob !== null ||
    !creditsOk ||
    (inputMode === "url" ? !urlValue.trim() : !textOk);

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-[22px] border border-white/16 bg-white/12 p-1.5">
          <button
            type="button"
            disabled
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[22px] border border-white/32 text-white opacity-50 transition-colors hover:bg-white/10"
            aria-label="Voice input (coming soon)"
          >
            <Mic className="h-4 w-4" aria-hidden />
          </button>
          <input
            type={inputMode === "url" ? "url" : "text"}
            value={inputMode === "url" ? urlValue : textValue}
            onChange={(e) =>
              inputMode === "url"
                ? onUrlChange(e.target.value)
                : onTextChange(e.target.value)
            }
            placeholder={composerPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-[14px] font-normal leading-[20px] tracking-[0.14px] text-white outline-none placeholder:text-white/64"
          />
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[22px] border border-white/32 text-white transition-colors hover:bg-white/10"
              aria-label="Attach file or YouTube URL"
            >
              <Paperclip className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void onSubmit()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[32px] bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={isSubmitting || activeJob ? "Generating…" : "Send clip request"}
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
          Ada is beta release and may give incorrect or harmful info
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

type AdaVideoControlDockProps = {
  selectedVoice: string;
  onVoiceChange: (id: string) => void;
  inputMode: "url" | "text";
  onInputModeChange: (m: "url" | "text") => void;
  inputBarProps: AdaVideoInputBarProps;
  /** Hide voice row until user has started the chat (preflight or any job). */
  showVoiceRow?: boolean;
};

function AdaVideoControlDock({
  selectedVoice,
  onVoiceChange,
  inputMode,
  onInputModeChange,
  inputBarProps,
  showVoiceRow = true,
}: AdaVideoControlDockProps): JSX.Element {
  return (
    <div className="shrink-0 border-t border-white/[0.06] bg-[#0a0a0c]/90 px-4 pb-4 pt-3 backdrop-blur-md sm:px-8 md:px-12">
      {showVoiceRow ? (
        <>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-white/40">
            Voice
          </p>
          <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {VOICE_OPTIONS.map((v) => {
              const sel = selectedVoice === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onVoiceChange(v.id)}
                  className={cn(
                    "shrink-0 rounded-2xl border px-3 py-1.5 text-left transition-all",
                    sel
                      ? "border-white/20 bg-white/[0.08] text-white shadow-sm"
                      : "border-transparent bg-white/[0.03] text-white/55 hover:bg-white/[0.06] hover:text-white/80",
                  )}
                >
                  <p className="text-[12px] font-medium">{v.label}</p>
                  <p className="max-w-[132px] truncate text-[10px] text-white/40">{v.desc}</p>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      <div className="mb-2 flex flex-wrap justify-center gap-2">
        {(["url", "text"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onInputModeChange(mode)}
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
      <AdaVideoInputBar {...inputBarProps} />
    </div>
  );
}

function UserPromptBubble({ text }: { text: string }): JSX.Element {
  return (
    <div className="flex w-full flex-col items-end">
      <div className="flex max-w-full items-end gap-2">
        <div className="max-w-[min(100%,560px)] rounded-2xl rounded-tr-md border border-white/[0.08] bg-white/[0.07] px-3.5 py-2.5">
          <p className="text-[13px] font-normal leading-relaxed text-white/95">{text}</p>
        </div>
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70"
          aria-hidden
        >
          <User className="size-4" aria-hidden />
        </div>
      </div>
    </div>
  );
}

function AdaAssistantRefineBubble(): JSX.Element {
  return (
    <div className="flex w-full max-w-[min(100%,640px)] items-start gap-2">
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-white/80"
        aria-hidden
      >
        <Bird className="size-4 rotate-[12deg]" aria-hidden />
      </div>
      <div className="min-w-0 rounded-2xl rounded-tl-md border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5">
        <p className="text-[13px] font-medium leading-snug text-white/90">Quick refine</p>
        <p className="mt-1 text-[12px] leading-relaxed text-white/55">
          What vibe or platform should we lean into? (e.g. TikTok fast cuts, calm explainer, ad read.) Reply
          below — or type <span className="font-medium text-white/70">skip</span> to use only your first message.
        </p>
      </div>
    </div>
  );
}

function GeneratingStatusPill({
  startedAt,
  onCancel,
}: {
  startedAt: string;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div
        className="inline-flex items-center gap-2 rounded-xl border border-white/64 px-3 py-2 text-[14px] font-normal leading-5 text-white"
        role="status"
      >
        <Loader2 className="size-4 shrink-0 animate-spin text-white" aria-hidden />
        <span>Generating...</span>
        <ElapsedTimer startedAt={startedAt} />
      </div>
      <button
        type="button"
        onClick={() => void onCancel()}
        className="text-[12px] text-white/50 transition-colors hover:text-red-400"
        aria-label="Cancel video generation"
      >
        Cancel
      </button>
    </div>
  );
}

function adaClipResponseBody(job: VideoJob): string {
  const st = job.status;
  if (st === "complete" && job.output_url) {
    return "I've clipped your video from that prompt. Preview it below and download when you're ready!";
  }
  if (st === "failed") {
    return job.error_message?.trim() || "Generation didn't finish.";
  }
  if (st === "cancelled") {
    return "This clip generation was cancelled.";
  }
  return STATUS_MAP[st]?.label ?? "Working on your clip…";
}

type AdaVideoClipResponseCardProps = {
  job: VideoJob;
  onRegenerate: (script: string) => void;
};

function AdaVideoClipResponseCard({ job, onRegenerate }: AdaVideoClipResponseCardProps): JSX.Element {
  const [playing, setPlaying] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [thumb, setThumb] = useState<"up" | "down" | null>(null);
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
    <div className="flex w-full max-w-[600px] items-end gap-2">
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-white/85"
        aria-hidden
      >
        <Bird className="size-[18px] rotate-[12deg]" aria-hidden />
      </div>
      <div
        className="min-w-0 flex-1 rounded-2xl rounded-bl-md border border-white/[0.08] bg-white/[0.05] p-3.5"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="mb-2 flex items-center gap-1.5">
          <Video className="size-3.5 shrink-0 text-white/50" aria-hidden />
          <span className="text-[12px] font-medium uppercase tracking-wide text-white/45">Video</span>
        </div>
        <p className="mb-3 text-[13px] font-normal leading-relaxed text-white/85">
          {adaClipResponseBody(job)}
        </p>

        <div className="relative mx-auto mb-3 w-full max-w-[504px] overflow-hidden rounded-xl bg-black/30 ring-1 ring-white/[0.06]">
          <div className="relative aspect-[9/16] w-full">
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
                  className="group/v absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/25"
                  aria-label={playing ? "Pause clip" : "Play clip"}
                >
                  <div
                    className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-lg transition-all duration-200",
                      playing || hovered ? "scale-100 opacity-100" : "scale-90 opacity-0 md:group-hover/v:scale-100 md:group-hover/v:opacity-100",
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
              <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 p-6 text-center">
                <AlertCircle className="h-8 w-8 text-white/30" aria-hidden />
                <p className="text-[12px] capitalize text-white/50">{st}</p>
                {st === "failed" ? (
                  <p className="text-[11px] text-white/40">No credits were charged.</p>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 bg-black/20 py-8">
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
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-2.5">
          <button
            type="button"
            onClick={() => setThumb((t) => (t === "up" ? null : "up"))}
            className={cn(
              "rounded-xl p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white",
              thumb === "up" && "text-[#D31CD7]",
            )}
            aria-label="Thumbs up"
            aria-pressed={thumb === "up"}
          >
            <ThumbsUp className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setThumb((t) => (t === "down" ? null : "down"))}
            className={cn(
              "rounded-xl p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white",
              thumb === "down" && "text-[#D31CD7]",
            )}
            aria-label="Thumbs down"
            aria-pressed={thumb === "down"}
          >
            <ThumbsDown className="size-3.5" aria-hidden />
          </button>
          {complete ? (
            <>
              <a
                href={job.output_url!}
                download
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-xl p-1.5 text-[14px] font-normal text-white transition-colors hover:bg-white/10"
                aria-label="Download this clip"
              >
                <Download className="size-3.5" aria-hidden />
                Download
              </a>
              <button
                type="button"
                onClick={() => onRegenerate(job.script)}
                className="flex items-center gap-1.5 rounded-xl p-1.5 text-[14px] font-normal text-white transition-colors hover:bg-white/10"
                aria-label="Regenerate clip with same prompt"
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Regenerate
              </button>
              <button
                type="button"
                disabled
                className="flex cursor-not-allowed items-center gap-1.5 rounded-xl p-1.5 text-[14px] font-normal text-white/35"
                aria-label="Customize (coming soon)"
              >
                <Link2 className="size-3.5" aria-hidden />
                Customize
              </button>
              <button
                type="button"
                onClick={handleCopyLink}
                className="ml-auto flex items-center gap-1.5 rounded-xl p-1.5 text-[14px] font-normal text-white/70 transition-colors hover:bg-white/10 hover:text-white md:ml-0"
                aria-label="Copy video link"
              >
                <Copy className="size-3.5" aria-hidden />
                Copy link
              </button>
            </>
          ) : null}
        </div>

        <p className="mt-2 text-[11px] text-white/40" suppressHydrationWarning>
          {relativeFromNow(job.created_at)}
        </p>
      </div>
    </div>
  );
}

export function AdaVideoWorkspace({
  userId,
  authUser = null,
  creditsRemaining,
  creditsUnlimited,
  onCreditChange,
  onJobFinished,
  onUpgrade,
  onOpenSignIn,
  headerTrailing,
  onSidebarNavigate: _onSidebarNavigate,
  onWorkspaceSettings: _onWorkspaceSettings,
  onWorkspaceAccount: _onWorkspaceAccount,
  variant = "default",
}: AdaVideoWorkspaceProps): JSX.Element {
  void _onSidebarNavigate;
  void _onWorkspaceSettings;
  void _onWorkspaceAccount;
  const kit = variant === "adaKit";
  const [kitVideoMode, setKitVideoMode] = useState<
    "source_clip" | "stock_script"
  >("source_clip");
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
  /** First “My idea” send stages script; second send merges follow-up (ChatGPT-style) then POSTs. */
  const [preflightStagedScript, setPreflightStagedScript] = useState<string | null>(null);

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

  useEffect(() => {
    if (inputMode === "url") setPreflightStagedScript(null);
  }, [inputMode]);

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

  const handleGenerate = async (scriptOverride?: string): Promise<void> => {
    const trimmedOverride = scriptOverride?.trim() ?? "";
    if (trimmedOverride) {
      setPreflightStagedScript(null);
    }

    let payloadScript =
      trimmedOverride.length > 0
        ? trimmedOverride
        : inputMode === "url"
          ? urlValue.trim()
          : textValue.trim();

    setSubmitError(null);
    setActiveTerminalNote(null);
    if (!userId) {
      setSubmitError("Sign in to generate a video.");
      return;
    }
    if (!payloadScript || isSubmitting) return;

    const noJobsYet = jobHistory.length === 0 && !activeJob;
    const wantPreflight =
      kit &&
      inputMode === "text" &&
      trimmedOverride.length === 0 &&
      noJobsYet;

    if (wantPreflight && !preflightStagedScript) {
      if (payloadScript.length < SCRIPT_MIN_LEN) {
        setSubmitError(`Enter at least ${SCRIPT_MIN_LEN} characters.`);
        return;
      }
      setPreflightStagedScript(payloadScript);
      setTextValue("");
      return;
    }

    if (wantPreflight && preflightStagedScript) {
      const follow = payloadScript.trim();
      if (follow.length < 2 && follow.toLowerCase() !== "skip") {
        setSubmitError("Add a short note or type skip.");
        return;
      }
      payloadScript =
        follow.toLowerCase() === "skip"
          ? preflightStagedScript
          : `${preflightStagedScript}\n\n— ${follow}`;
      setPreflightStagedScript(null);
      setTextValue("");
    }

    if (payloadScript.length < SCRIPT_MIN_LEN) {
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
        body: JSON.stringify({ script: payloadScript, voiceId: selectedVoice }),
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
        script: payloadScript,
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
    setPreflightStagedScript(null);
    setInputMode("text");
    setTextValue(pick.prompt);
  }, []);

  const handleShellNav = useCallback((id: AdaVideoShellNavId): void => {
    if (id === "clip_my_video") setKitVideoMode("source_clip");
    if (id === "stock_from_script") setKitVideoMode("stock_script");
  }, []);

  const statusKey = activeJobData?.status ?? "queued";
  const statusInfo = STATUS_MAP[statusKey] ?? STATUS_MAP.queued;
  const progressPct = statusInfo.pct;

  const transcriptJobs = useMemo(
    () =>
      [...jobHistory]
        .filter((j) => (activeJob ? j.id !== activeJob : true))
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        ),
    [jobHistory, activeJob],
  );

  const emptyStateA =
    !activeJob &&
    jobHistory.length === 0 &&
    !loadingHistory;

  const showEmptyHero = emptyStateA && !preflightStagedScript;

  const resultsStateB =
    activeJob !== null || jobHistory.length > 0;

  const sidebarProps: AdaVideoSidebarProps = {
    activeTab:
      kitVideoMode === "source_clip" ? "clip_my_video" : "stock_from_script",
    onTabChange: (id) => {
      handleShellNav(id);
      setShellMenuOpen(false);
    },
  };

  const examplePromptsRowRef = useRef<HTMLDivElement>(null);

  const inputBarProps: AdaVideoInputBarProps = {
    inputMode,
    urlValue,
    textValue,
    onUrlChange: setUrlValue,
    onTextChange: setTextValue,
    onSubmit: () => {
      void handleGenerate(undefined);
    },
    isSubmitting,
    activeJob,
    creditsOk,
    creditCost,
    submitError,
    userId,
    onSurpriseMe: handleSurpriseMe,
    onUpgrade,
    composerPlaceholder:
      preflightStagedScript && inputMode === "text"
        ? "Add a detail or type skip…"
        : "Message Ada…",
    allowShortComposer: Boolean(preflightStagedScript && inputMode === "text"),
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
    <div className="relative flex h-screen w-screen overflow-hidden bg-[#0c0c0e] font-[family-name:var(--font-instrument-sans)] text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_85%_55%_at_50%_-15%,rgba(124,58,237,0.12),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_100%_80%,rgba(136,0,220,0.06),transparent_50%)]" />
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
          showRecent={kitVideoMode === "stock_script"}
        />

        {kitVideoMode === "stock_script" && recentOpen ? (
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

        {kitVideoMode === "source_clip" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <VideoVariationWorkspace
              user={authUser ?? (userId ? { id: userId, email: "" } : null)}
              creditsRemaining={creditsRemaining}
              creditsUnlimited={creditsUnlimited}
              setCreditsRemaining={(n) => onCreditChange?.(n)}
              onOpenBuy={() => onUpgrade?.()}
              onOpenSignIn={() => onOpenSignIn?.()}
              onJobFinished={() => onJobFinished?.()}
              onOpenMobileNav={() => setShellMenuOpen(true)}
              hideMarketingTitle
              omitChromeHeader
            />
          </div>
        ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {loadingHistory && !resultsStateB ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="size-10 animate-spin text-white/40" aria-hidden />
            </div>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-4 sm:px-8 md:px-12">
                {showEmptyHero ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-start gap-4 pt-8 sm:pt-12">
                    <div className="relative mx-auto h-[200px] w-[180px] shrink-0">
                      <div
                        className="pointer-events-none absolute left-0 top-0 h-[200px] w-[180px] scale-110 opacity-90 blur-[25px]"
                        aria-hidden
                      >
                        <div className="absolute left-[6px] top-4 h-[166px] w-[155px] rounded-full bg-[#3600AA]" />
                        <div className="absolute left-[72px] top-0 h-[146px] w-[136px] rotate-[60deg] rounded-full bg-[#6800BA]" />
                        <div className="absolute left-10 top-[102px] h-[116px] w-[107px] -rotate-[66deg] rounded-full bg-[#A400A7]" />
                      </div>
                      <div className="absolute left-[30px] top-10 z-10 flex h-[120px] w-[120px] items-center justify-center rounded-full bg-white/12 shadow-[0_8px_20px_rgba(0,0,0,0.16)]">
                        <Bird className="size-8 rotate-[15deg] text-white" aria-hidden />
                      </div>
                    </div>

                    <h2 className="max-w-2xl self-stretch text-center font-[family-name:var(--font-instrument-serif)] text-[28px] font-normal tracking-tight text-white/95 sm:text-[32px]">
                      Describe your script for stock footage + voiceover
                    </h2>

                    <div className="relative w-full max-w-full overflow-hidden">
                      <div
                        ref={examplePromptsRowRef}
                        className="flex justify-center gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                      >
                        {EXAMPLE_PROMPTS.map((ex) => (
                          <button
                            key={ex.id}
                            type="button"
                            onClick={() => {
                              setInputMode("text");
                              setTextValue(ex.prompt);
                            }}
                            className="group relative flex h-[220px] w-[280px] shrink-0 flex-col justify-end gap-2 overflow-hidden rounded-2xl border border-[rgba(10,5,15,0.16)] p-3"
                            style={{
                              backgroundImage: `url(${ex.thumb})`,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }}
                            aria-label={`Use prompt: ${ex.prompt}`}
                          >
                            <div className="pointer-events-none absolute inset-0 bg-black/10 transition-colors group-hover:bg-black/5" />
                            <div className="relative z-[1] w-full rounded-xl bg-[rgba(10,5,15,0.16)] px-3 py-[10px] backdrop-blur-[50px]">
                              <p className="text-left text-[16px] font-medium leading-[24px] tracking-[0.16px] text-white">
                                {ex.prompt}
                              </p>
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

                    <div className="flex w-full max-w-3xl justify-between px-1">
                      <button
                        type="button"
                        className="rounded-full p-1 text-white/64 transition-colors hover:bg-white/10 hover:text-white"
                        aria-label="Scroll suggestions left"
                        onClick={() =>
                          examplePromptsRowRef.current?.scrollBy({
                            left: -296,
                            behavior: "smooth",
                          })
                        }
                      >
                        <ChevronLeft className="size-6" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="rounded-full p-1 text-white/64 transition-colors hover:bg-white/10 hover:text-white"
                        aria-label="Scroll suggestions right"
                        onClick={() =>
                          examplePromptsRowRef.current?.scrollBy({
                            left: 296,
                            behavior: "smooth",
                          })
                        }
                      >
                        <ChevronRight className="size-6" aria-hidden />
                      </button>
                    </div>
                  </div>
                ) : emptyStateA && preflightStagedScript ? (
                  <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 pb-6 pt-4">
                    <UserPromptBubble text={preflightStagedScript} />
                    <AdaAssistantRefineBubble />
                  </div>
                ) : (
                  <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 pb-4">
                    {transcriptJobs.map((job) => (
                      <Fragment key={job.id}>
                        <UserPromptBubble text={job.script} />
                        <AdaVideoClipResponseCard
                          job={job}
                          onRegenerate={(script) => {
                            setInputMode("text");
                            setTextValue(script);
                            void handleGenerate(script);
                          }}
                        />
                      </Fragment>
                    ))}

                    {activeJob && activeJobData ? (
                      <>
                        <UserPromptBubble text={activeJobData.script} />
                        <GeneratingStatusPill
                          startedAt={activeJobData.created_at}
                          onCancel={handleCancel}
                        />
                      </>
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
                  </div>
                )}
              </div>

              <AdaVideoControlDock
                selectedVoice={selectedVoice}
                onVoiceChange={setSelectedVoice}
                inputMode={inputMode}
                onInputModeChange={setInputMode}
                inputBarProps={inputBarProps}
                showVoiceRow={!showEmptyHero}
              />
            </>
          )}
        </div>
        )}
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
