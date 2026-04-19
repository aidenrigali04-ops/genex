"use client";

import type { ReactNode } from "react";
import { useCallback, useRef } from "react";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Crown,
  Mic,
  Paperclip,
  Settings,
  Sparkles,
  UserRound,
  Video,
} from "lucide-react";

import { cn } from "@/lib/utils";

const MAGENTA_GRAD =
  "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] shadow-[0_0_20px_rgba(203,45,206,0.24)]";

export function AdaFigmaAmbientBackground() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden bg-[#0A050F]"
      aria-hidden
    >
      <div
        className="absolute -left-[20%] top-[-35%] h-[95%] w-[75%] -rotate-[13deg] bg-[#180532] opacity-70 blur-[100px]"
        style={{ transformOrigin: "top left" }}
      />
      <div
        className="absolute -right-[30%] bottom-[-40%] h-[90%] w-[85%] rotate-[148deg] bg-[#300537] opacity-55 blur-[110px]"
        style={{ transformOrigin: "top left" }}
      />
      <div
        className="absolute -left-[45%] bottom-[-25%] h-[70%] w-[95%] -rotate-[57deg] bg-[#230639] opacity-50 blur-[95px]"
        style={{ transformOrigin: "top left" }}
      />
    </div>
  );
}

export type FigmaMainNavId = "clip" | "video";

export type AdaFigmaSidebarNavProps = {
  activeMain: FigmaMainNavId;
  onSelectMain: (id: FigmaMainNavId) => void;
  onUpgrade: () => void;
  onSettings: () => void;
  onAccount: () => void;
  recentSection?: ReactNode;
};

const MAIN_NAV: {
  id: FigmaMainNavId;
  label: string;
  icon: typeof Clapperboard;
}[] = [
  { id: "clip", label: "Clip generation", icon: Clapperboard },
  { id: "video", label: "Video", icon: Video },
];

export function AdaFigmaSidebarNav({
  activeMain,
  onSelectMain,
  onUpgrade,
  onSettings,
  onAccount,
  recentSection,
}: AdaFigmaSidebarNavProps) {
  return (
    <div
      className={cn(
        "flex h-full w-[280px] shrink-0 flex-col border-r border-white",
        "bg-[rgba(198,108,255,0.08)] font-[family-name:var(--font-instrument-sans)]",
      )}
    >
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-[32px]",
              MAGENTA_GRAD,
            )}
          >
            <Sparkles className="size-5 text-white" aria-hidden />
          </div>
          <span
            className="font-[family-name:var(--font-instrument-serif)] text-4xl leading-[48px] tracking-[0.36px] text-white"
            style={{ fontWeight: 400 }}
          >
            GenEx
          </span>
        </div>
        <div className="flex items-center gap-1 text-white opacity-90">
          <ChevronLeft className="size-4" aria-hidden />
          <ChevronRight className="size-5" aria-hidden />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-5 pt-5">
        <div className="flex flex-col gap-3">
          {MAIN_NAV.map(({ id, label, icon: Icon }) => {
            const active = activeMain === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectMain(id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[32px] py-1 pl-4 pr-4 text-left text-base leading-9 text-white transition-opacity",
                  active && MAGENTA_GRAD,
                  !active && "hover:bg-white/10",
                )}
                style={{ fontWeight: 400 }}
              >
                <Icon className="size-5 shrink-0 text-white" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
            );
          })}
        </div>

        <div className="h-px w-full bg-white" />

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onUpgrade}
            className="flex w-full items-center gap-3 rounded-[32px] py-1 pl-4 pr-4 text-left text-base leading-9 text-white transition-colors hover:bg-white/10"
            style={{ fontWeight: 400 }}
          >
            <Crown className="size-5 shrink-0" aria-hidden />
            Upgrade plan
          </button>
          <button
            type="button"
            onClick={onSettings}
            className="flex w-full items-center gap-3 rounded-[32px] py-1 pl-4 pr-4 text-left text-base leading-9 text-white transition-colors hover:bg-white/10"
            style={{ fontWeight: 400 }}
          >
            <Settings className="size-5 shrink-0" aria-hidden />
            Settings
          </button>
          <button
            type="button"
            onClick={onAccount}
            className="flex w-full items-center gap-3 rounded-[32px] py-1 pl-4 pr-4 text-left text-base leading-9 text-white transition-colors hover:bg-white/10"
            style={{ fontWeight: 400 }}
          >
            <UserRound className="size-5 shrink-0" aria-hidden />
            My account
          </button>
        </div>

        {recentSection ? (
          <div className="mt-2 border-t border-white/20 pt-4">{recentSection}</div>
        ) : null}
      </div>
    </div>
  );
}

const HUB_SUGGESTIONS: { title: string; subtitle: string; prompt: string }[] = [
  {
    title: "Turn a transcript into viral hooks",
    subtitle: "Paste notes or a podcast transcript — get clip-ready hooks.",
    prompt:
      "I have a transcript about [topic]. Give me 5 viral TikTok hooks in the first 3 seconds style.",
  },
  {
    title: "YouTube URL → clip package",
    subtitle: "Drop a link; we’ll outline moments and script angles.",
    prompt: "Here’s a YouTube URL to repurpose into Shorts/Reels/TikTok clips: ",
  },
  {
    title: "Rewrite for Shorts tone",
    subtitle: "Casual, punchy voice for 30–60s vertical scripts.",
    prompt:
      "Rewrite this idea for Shorts: keep it casual, punchy, with a strong hook in line 1.\n\n",
  },
  {
    title: "Five angles on one topic",
    subtitle: "Contrarian, educational, and story-led variations.",
    prompt:
      "Topic: [your topic]. Give me 5 different clip angles (contrarian, storytime, educational, etc.).",
  },
];

/** Visual prompt tiles (Figma “Image” row) + text prompts for “Surprise me”. */
const CAROUSEL_PROMPT_CARDS: { prompt: string; thumb: string }[] = [
  {
    prompt: "Gorgeous abandoned medieval mansion in a fairytale forest",
    thumb:
      "linear-gradient(145deg, #1a0a2e 0%, #3d2060 40%, #6b2d7a 100%), linear-gradient(220deg, rgba(211,28,215,0.35) 0%, transparent 55%)",
  },
  {
    prompt: "Give me photo of a man working in an office in a big city.",
    thumb:
      "linear-gradient(145deg, #0f1729 0%, #1e3a5f 45%, #2d4a7c 100%), linear-gradient(160deg, rgba(136,0,220,0.3) 0%, transparent 50%)",
  },
  {
    prompt: "Give me photo of a majestic peacock rising in the sky",
    thumb:
      "linear-gradient(145deg, #1a1030 0%, #4a1e5c 50%, #7a2d6a 100%), linear-gradient(200deg, rgba(255,200,100,0.2) 0%, transparent 45%)",
  },
  {
    prompt: "Give me a nice scenery of a girl playing in a green field",
    thumb:
      "linear-gradient(145deg, #0d2818 0%, #1a4d32 50%, #2d6a45 100%), linear-gradient(180deg, rgba(100,200,120,0.25) 0%, transparent 55%)",
  },
];

export type AdaFigmaClipHubProps = {
  text: string;
  onTextChange: (v: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  onPickSuggestion: (prompt: string) => void;
  /** When user picks a file via the paperclip control, switches hub to file-backed generation. */
  onFileSelected?: (file: File) => void;
};

export function AdaFigmaClipHub({
  text,
  onTextChange,
  onSubmit,
  canSubmit,
  onPickSuggestion,
  onFileSelected,
}: AdaFigmaClipHubProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollCarousel = useCallback((dir: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 296, behavior: "smooth" });
  }, []);

  const surprisePrompt = useCallback(() => {
    const fromCarousel = CAROUSEL_PROMPT_CARDS.map((c) => c.prompt);
    const fromHub = HUB_SUGGESTIONS.map((s) => s.prompt);
    const pool = [...fromCarousel, ...fromHub];
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? fromCarousel[0];
    onPickSuggestion(pick);
  }, [onPickSuggestion]);

  return (
    <div className="relative z-[1] flex min-h-0 flex-1 flex-col font-[family-name:var(--font-instrument-sans)]">
      <div className="flex min-h-0 flex-1 flex-col px-6 sm:px-[120px]">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 py-8">
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
              <Sparkles
                className="size-14 rotate-[15deg] text-white"
                strokeWidth={1.25}
                aria-hidden
              />
            </div>
          </div>
          <h1
            className="max-w-3xl text-center font-[family-name:var(--font-instrument-serif)] text-4xl tracking-[0.36px] text-white"
            style={{ fontWeight: 400 }}
          >
            Hi, How can I help you today?
          </h1>
        </div>

        <div className="relative pb-4">
          <div
            className="pointer-events-none absolute inset-y-0 left-0 z-[2] w-16 bg-[linear-gradient(90deg,#21062A_0%,rgba(33,6,42,0)_100%)] sm:w-24"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-16 bg-[linear-gradient(270deg,#1D0625_0%,rgba(29,6,37,0)_100%)] sm:w-24"
            aria-hidden
          />

          <div
            ref={scrollRef}
            className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {CAROUSEL_PROMPT_CARDS.map(({ prompt, thumb }) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onPickSuggestion(prompt)}
                className="group relative flex h-[220px] w-[280px] shrink-0 snap-start flex-col justify-end overflow-hidden rounded-2xl p-3 text-left outline outline-1 -outline-offset-1 outline-[rgba(10,5,15,0.16)] transition-transform hover:scale-[1.02]"
                style={{ background: thumb }}
              >
                <div className="pointer-events-none absolute inset-0 bg-black/15 transition-colors group-hover:bg-black/5" />
                <div className="relative rounded-xl bg-[rgba(10,5,15,0.16)] px-3 py-2.5 backdrop-blur-[50px]">
                  <p
                    className="text-base leading-6 tracking-[0.16px] text-white"
                    style={{ fontWeight: 500 }}
                  >
                    {prompt}
                  </p>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-2 flex justify-between px-1 sm:px-2">
            <button
              type="button"
              className="flex size-6 items-center justify-center text-white/64 transition-colors hover:text-white"
              aria-label="Scroll prompts left"
              onClick={() => scrollCarousel(-1)}
            >
              <ChevronLeft className="size-6" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className="flex size-6 items-center justify-center text-white/64 transition-colors hover:text-white"
              aria-label="Scroll prompts right"
              onClick={() => scrollCarousel(1)}
            >
              <ChevronRight className="size-6" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>

      <div className="shrink-0 space-y-3 px-6 pb-6 sm:px-[100px]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          <div className="flex min-h-[46px] flex-1 items-center gap-3 rounded-[22px] border border-white/16 bg-white/12 p-1.5 outline outline-1 outline-offset-[-1px] outline-white/16">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".flac,.m4a,.mp3,.mp4,.mpeg,.mpga,.mov,.m4v,.oga,.ogg,.wav,.webm,.txt,.md,.markdown,.csv,.srt,.vtt,.json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f && onFileSelected) onFileSelected(f);
              }}
            />
            <button
              type="button"
              className="flex size-8 shrink-0 items-center justify-center rounded-[22px] border border-white/32 text-white transition-colors hover:bg-white/10"
              aria-label="Attach file"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-4" aria-hidden />
            </button>
            <input
              type="text"
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              placeholder="Message GenEx…"
              className="min-w-0 flex-1 bg-transparent text-sm leading-5 tracking-[0.14px] text-white outline-none placeholder:text-white/64"
              style={{ fontWeight: 400 }}
            />
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="flex size-8 items-center justify-center rounded-[22px] border border-white/32 text-white transition-colors hover:bg-white/10"
                aria-label="Voice (coming soon)"
                disabled
              >
                <Mic className="size-4 opacity-50" aria-hidden />
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={onSubmit}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-white transition-opacity",
                  MAGENTA_GRAD,
                  !canSubmit && "cursor-not-allowed opacity-40",
                )}
                aria-label="Send"
              >
                <ArrowUp className="size-4" aria-hidden />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={surprisePrompt}
            className="inline-flex shrink-0 items-center justify-center gap-2 self-stretch rounded-[32px] border border-white/48 px-3 py-2.5 text-sm font-medium tracking-[0.14px] text-white transition-colors hover:bg-white/10 sm:self-auto"
            style={{ fontWeight: 500 }}
          >
            <Sparkles className="size-5 shrink-0 text-white" aria-hidden />
            Surprise me
          </button>
        </div>

        <p
          className="flex items-center justify-center gap-2 text-center text-xs leading-6 tracking-[0.12px] text-white/64"
          style={{ fontWeight: 400 }}
        >
          <span
            className="relative inline-block size-4 shrink-0 rounded border border-white/64"
            aria-hidden
          >
            <span className="absolute left-1/2 top-2.5 size-1 -translate-x-1/2 rounded-full bg-white/64" />
          </span>
          GenEx is beta release and may give incorrect or harmful info
        </p>
      </div>
    </div>
  );
}

export type AdaFigmaMainHeaderProps = {
  menuButton?: ReactNode;
  title: string;
  recentTrigger: ReactNode;
  trailing: ReactNode;
};

export function AdaFigmaMainHeader({
  menuButton,
  title,
  recentTrigger,
  trailing,
}: AdaFigmaMainHeaderProps) {
  return (
    <header className="relative z-[1] flex h-20 shrink-0 items-center justify-between border-b border-white px-6">
      <div className="flex min-w-0 items-center gap-3">
        {menuButton}
        <h2
          className="truncate font-[family-name:var(--font-instrument-serif)] text-3xl tracking-[0.36px] text-white sm:text-4xl"
          style={{ fontWeight: 400 }}
        >
          {title}
        </h2>
      </div>
      <div className="flex items-center gap-3">
        {recentTrigger}
        {trailing}
      </div>
    </header>
  );
}
