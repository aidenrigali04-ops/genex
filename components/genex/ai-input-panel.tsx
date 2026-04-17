"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Globe, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

export type AiModelOption = {
  id: string;
  label: string;
  description: string;
};

const AI_MODELS: AiModelOption[] = [
  {
    id: "gpt-4o",
    label: "GPT 4o",
    description: "Best for hooks & viral angles",
  },
  {
    id: "claude-sonnet",
    label: "Claude",
    description: "Best for long-form & LinkedIn",
  },
  {
    id: "perplexity",
    label: "Research",
    description: "Search + AI synthesis",
  },
];

const QUICK_ACTIONS = [
  { id: "hook", label: "Write Hook" },
  { id: "thread", label: "Make Thread" },
  { id: "repurpose", label: "Repurpose" },
];

export type AiInputPanelProps = {
  inputMode: "text" | "url" | "file";
  onInputModeChange: (mode: "text" | "url" | "file") => void;
  text: string;
  onTextChange: (v: string) => void;
  url: string;
  onUrlChange: (v: string) => void;
  uploadFile: File | null;
  onFileChange: (f: File | null) => void;
  selectedModel: string;
  onModelChange: (id: string) => void;
  loading: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onQuickAction?: (id: string) => void;
  maxUploadMb: number;
  /** Sits inside the glass shell under chat — flatter white card. */
  embedded?: boolean;
};

export function AiInputPanel({
  inputMode,
  onInputModeChange,
  text,
  onTextChange,
  url,
  onUrlChange,
  uploadFile,
  onFileChange,
  selectedModel,
  onModelChange,
  loading,
  canSubmit,
  onSubmit,
  onQuickAction,
  maxUploadMb,
  embedded = false,
}: AiInputPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!uploadFile && fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [uploadFile]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (canSubmit && !loading) onSubmit();
    }
  };

  return (
    <div
      className={cn(
        "overflow-hidden shadow-lg",
        embedded
          ? "rounded-xl border border-white/70 bg-white/95 shadow-[0_12px_40px_-16px_rgba(124,58,237,0.2)] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/80"
          : "rounded-2xl border border-white/50 bg-white/70 backdrop-blur-xl",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-black/6 px-4 py-2.5 dark:border-white/10">
        <div className="flex items-center gap-1.5">
          <Globe
            className="size-4 shrink-0 text-[#6C47FF] opacity-90"
            strokeWidth={1.5}
            aria-hidden
          />
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e) => onModelChange(e.target.value)}
              className="cursor-pointer appearance-none rounded-lg border-0 bg-transparent py-1.5 pr-7 pl-1 text-sm font-semibold text-[#1a1030] outline-none transition-colors hover:bg-violet-50/80 focus:ring-2 focus:ring-violet-400/30 disabled:opacity-50 dark:text-zinc-100 dark:hover:bg-white/5"
              disabled={loading}
            >
              {AI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-[#6C47FF]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>

        <div className="h-4 w-px bg-black/10 dark:bg-white/15" />

        <button
          type="button"
          onClick={() => onInputModeChange("url")}
          disabled={loading}
          aria-pressed={inputMode === "url"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            inputMode === "url"
              ? "border-violet-200 bg-violet-100 text-[#6C47FF] dark:border-violet-500/40 dark:bg-violet-950/60 dark:text-violet-200"
              : "border-transparent bg-black/3 text-[#6B6B8A] hover:bg-black/6 hover:text-[#1a1030] dark:bg-white/5 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100",
          )}
        >
          <Globe className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          Search
        </button>

        <div className="h-4 w-px bg-black/10 dark:bg-white/15" />

        <div className="flex items-center gap-1">
          {(["text", "file"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onInputModeChange(mode)}
              disabled={loading}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                inputMode === mode
                  ? "bg-violet-100 text-[#6C47FF] dark:bg-violet-900/50 dark:text-violet-200"
                  : "text-[#6B6B8A] hover:bg-black/5 hover:text-[#1a1030] dark:hover:bg-white/10 dark:hover:text-zinc-100",
              )}
            >
              {mode === "text" ? "Text" : "File"}
            </button>
          ))}
        </div>

        <span className="ml-auto hidden text-xs text-[#9B8EC4] sm:block dark:text-zinc-500">
          {AI_MODELS.find((m) => m.id === selectedModel)?.description}
        </span>
      </div>

      <div className="px-4 pb-2 pt-4">
        {inputMode === "text" ? (
          <textarea
            ref={textareaRef}
            className="min-h-[120px] w-full resize-none bg-transparent text-[15px] leading-relaxed text-[#1a1030] outline-none placeholder:text-[#b4a8c9] dark:text-zinc-100 dark:placeholder:text-zinc-500"
            placeholder="Ask anything…"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
        ) : inputMode === "url" ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <svg
                className="h-4 w-4 shrink-0 text-[#9B8EC4]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                />
              </svg>
              <input
                type="url"
                className="flex-1 bg-transparent py-1 text-[15px] text-[#1a1030] outline-none placeholder:text-[#b4a8c9] dark:text-zinc-100 dark:placeholder:text-zinc-500"
                placeholder="https://youtube.com/watch?v=… or any article URL"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                disabled={loading}
              />
            </div>
            <p className="text-xs text-[#9B8EC4] dark:text-zinc-500">
              YouTube watch and youtu.be links load captions first when possible.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="rounded-lg border border-dashed border-violet-300 bg-violet-50/80 px-3 py-2.5 text-xs font-medium text-[#6C47FF] transition-colors hover:bg-violet-100 dark:border-violet-500/40 dark:bg-violet-950/50 dark:text-violet-200"
            >
              {uploadFile
                ? uploadFile.name
                : `Choose file (max ${maxUploadMb}MB)`}
            </button>
            {uploadFile ? (
              <button
                type="button"
                onClick={() => onFileChange(null)}
                className="text-xs text-[#9B8EC4] hover:text-[#6C47FF]"
              >
                Clear
              </button>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              accept=".flac,.m4a,.mp3,.mp4,.mpeg,.mpga,.mov,.m4v,.oga,.ogg,.wav,.webm,.txt,.md,.markdown,.csv,.srt,.vtt,.json"
              disabled={loading}
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-black/4 px-4 pb-4 pt-2 dark:border-white/10">
        <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={loading}
              onClick={() => onQuickAction?.(action.id)}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-violet-200/80 bg-white/90 px-3 py-1.5 text-xs font-medium text-[#6C47FF] shadow-sm transition-colors hover:border-violet-300 hover:bg-violet-50 dark:border-violet-500/30 dark:bg-zinc-900/60 dark:text-violet-200 dark:hover:bg-violet-950/60"
            >
              <Sparkles className="size-3.5 shrink-0 text-[#9333ea]" aria-hidden />
              {action.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={loading || !canSubmit}
          onClick={onSubmit}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all",
            canSubmit && !loading
              ? "bg-linear-to-br from-[#f0abfc] via-[#c471ed] to-[#7c3aed] text-white shadow-md hover:scale-105 hover:shadow-lg"
              : "cursor-not-allowed bg-black/10 text-white/40 dark:bg-white/10",
          )}
          aria-label={loading ? "Generating" : "Open refinement"}
        >
          {loading ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : (
            <svg
              className="w-[18px] translate-x-px"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
