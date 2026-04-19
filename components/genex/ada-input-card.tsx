"use client";

import { useRef, type KeyboardEvent } from "react";
import { ArrowUp, Link2, Paperclip, Upload } from "lucide-react";

import type { GenerationPresetId } from "@/lib/generation-presets";
import { cn } from "@/lib/utils";

const MODELS = [
  { id: "gpt-4o", label: "GPT-4o", badge: "OpenAI" },
  { id: "claude-sonnet", label: "Claude", badge: "Anthropic" },
  { id: "perplexity", label: "Research", badge: "Perplexity" },
];

const PRESET_CHIPS: { id: GenerationPresetId; label: string }[] = [
  { id: "viral_hook", label: "⚡ Viral Hook" },
  { id: "storytime", label: "📖 Story" },
  { id: "educational", label: "💡 Educational" },
  { id: "contrarian", label: "🔥 Contrarian" },
];

export type AdaInputCardProps = {
  inputMode: "text" | "url" | "file";
  onInputModeChange: (m: "text" | "url" | "file") => void;
  text: string;
  onTextChange: (v: string) => void;
  url: string;
  onUrlChange: (v: string) => void;
  uploadFile: File | null;
  onFileChange: (f: File | null) => void;
  selectedModel: string;
  onModelChange: (id: string) => void;
  preset: GenerationPresetId | null;
  onPresetChange: (p: GenerationPresetId | null) => void;
  loading: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  maxUploadMb: number;
};

export function AdaInputCard({
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
  preset,
  onPresetChange,
  loading,
  canSubmit,
  onSubmit,
  maxUploadMb,
}: AdaInputCardProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (canSubmit && !loading) onSubmit();
    }
  };

  return (
    <div className="overflow-hidden rounded-ada-card border border-ada-border bg-ada-card">
      <div className="flex items-center justify-between gap-2 border-b border-ada-border px-3 py-2">
        <div className="flex items-center gap-1">
          {(["text", "url", "file"] as const).map((mode) => {
            const Icon = mode === "url" ? Link2 : mode === "file" ? Upload : null;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onInputModeChange(mode)}
                disabled={loading}
                className={cn(
                  "flex items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-xs font-medium transition-colors",
                  inputMode === mode
                    ? "bg-ada-accent-subtle text-ada-accent-hover"
                    : "text-ada-disabled hover:text-ada-secondary",
                )}
              >
                {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
                {mode === "text" ? "Text / Idea" : mode === "url" ? "URL" : "File"}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 rounded-[6px] border border-ada-border bg-ada-app p-0.5">
          {MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onModelChange(m.id)}
              disabled={loading}
              className={cn(
                "rounded-[4px] px-2.5 py-1 text-xs font-medium transition-colors",
                selectedModel === m.id
                  ? "bg-ada-accent text-white"
                  : "text-ada-disabled hover:text-ada-secondary",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-[100px] px-4 py-3">
        {inputMode === "text" ? (
          <textarea
            className="min-h-[96px] w-full resize-none bg-transparent text-sm leading-relaxed text-ada-primary outline-none placeholder:text-ada-disabled"
            placeholder="Drop your transcript, article, idea, or notes… ⌘↵ to generate"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
        ) : inputMode === "url" ? (
          <div className="flex items-start gap-2 pt-1">
            <Link2
              className="mt-0.5 h-4 w-4 shrink-0 text-ada-disabled"
              aria-hidden
            />
            <input
              type="url"
              className="flex-1 bg-transparent text-sm text-ada-primary outline-none placeholder:text-ada-disabled"
              placeholder="https://youtube.com/watch?v=… or article URL"
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              disabled={loading}
            />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 py-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              className="flex items-center gap-2 rounded-ada-input border border-dashed border-ada-border-active bg-ada-elevated px-4 py-2.5 text-sm text-ada-accent-hover transition-colors hover:border-ada-accent"
            >
              <Paperclip className="h-4 w-4" aria-hidden />
              {uploadFile ? uploadFile.name : `Upload file (max ${maxUploadMb}MB)`}
            </button>
            {uploadFile ? (
              <button
                type="button"
                onClick={() => onFileChange(null)}
                className="text-xs text-ada-disabled transition-colors hover:text-ada-error"
              >
                Remove
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              accept=".flac,.m4a,.mp3,.mp4,.mpeg,.mpga,.mov,.m4v,.oga,.ogg,.wav,.webm,.txt,.md,.markdown,.csv,.srt,.vtt,.json"
              disabled={loading}
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-ada-border px-3 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {PRESET_CHIPS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              disabled={loading}
              onClick={() => onPresetChange(preset === id ? null : id)}
              className={cn(
                "rounded-ada-pill px-3 py-1 text-xs font-medium transition-all",
                preset === id
                  ? "bg-ada-accent text-white"
                  : "border border-ada-border bg-transparent text-ada-secondary hover:border-ada-border-active hover:text-ada-primary",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={loading || !canSubmit}
          onClick={onSubmit}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all",
            canSubmit && !loading
              ? "bg-linear-to-br from-[#7B5CFA] to-[#9B6FFF] text-white shadow-lg shadow-[#7B5CFA33] hover:scale-105 hover:shadow-[#7B5CFA55]"
              : "cursor-not-allowed bg-ada-border text-ada-disabled",
          )}
          aria-label={loading ? "Generating" : "Continue to refinement"}
        >
          {loading ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
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
            <ArrowUp className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}
