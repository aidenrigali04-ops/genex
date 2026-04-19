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

const MAGENTA_BTN =
  "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] shadow-[0_0_20px_rgba(203,45,206,0.24)]";

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
  /** Match Ada UI Kit / Figma dark glass styling (clip shell). */
  variant?: "default" | "adaKit";
  /** When true, primary submit is disabled (refinement Q&A is in progress below). */
  refinementActive?: boolean;
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
  variant = "default",
  refinementActive = false,
}: AdaInputCardProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const kit = variant === "adaKit";

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (canSubmit && !loading && !refinementActive) onSubmit();
    }
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border",
        kit
          ? "border-white/16 bg-white/[0.06] font-[family-name:var(--font-instrument-sans)] shadow-[0_4px_24px_rgba(0,0,0,0.2)] backdrop-blur-sm outline outline-1 -outline-offset-1 outline-white/10"
          : "rounded-ada-card border-ada-border bg-ada-card",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-2",
          kit ? "border-b border-white/12" : "border-b border-ada-border",
        )}
      >
        <div className="flex items-center gap-1">
          {(["text", "url", "file"] as const).map((mode) => {
            const Icon = mode === "url" ? Link2 : mode === "file" ? Upload : null;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onInputModeChange(mode)}
                disabled={loading || refinementActive}
                className={cn(
                  "flex items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-xs font-medium transition-colors",
                  kit &&
                    (inputMode === mode
                      ? cn(MAGENTA_BTN, "text-white")
                      : "text-white/55 hover:bg-white/10 hover:text-white"),
                  !kit &&
                    (inputMode === mode
                      ? "bg-ada-accent-subtle text-ada-accent-hover"
                      : "text-ada-disabled hover:text-ada-secondary"),
                )}
              >
                {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
                {mode === "text" ? "Text / Idea" : mode === "url" ? "URL" : "File"}
              </button>
            );
          })}
        </div>

        <div
          className={cn(
            "flex items-center gap-1 rounded-[6px] p-0.5",
            kit ? "border border-white/20 bg-black/20" : "border border-ada-border bg-ada-app",
          )}
        >
          {MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onModelChange(m.id)}
              disabled={loading || refinementActive}
              className={cn(
                "rounded-[4px] px-2.5 py-1 text-xs font-medium transition-colors",
                kit &&
                  (selectedModel === m.id
                    ? cn(MAGENTA_BTN, "text-white")
                    : "text-white/50 hover:text-white/80"),
                !kit &&
                  (selectedModel === m.id
                    ? "bg-ada-accent text-white"
                    : "text-ada-disabled hover:text-ada-secondary"),
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
            className={cn(
              "min-h-[96px] w-full resize-none bg-transparent text-sm leading-relaxed outline-none",
              kit
                ? "text-white placeholder:text-white/45"
                : "text-ada-primary placeholder:text-ada-disabled",
            )}
            placeholder="Drop your transcript, article, idea, or notes… ⌘↵ to generate"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading || refinementActive}
          />
        ) : inputMode === "url" ? (
          <div className="flex items-start gap-2 pt-1">
            <Link2
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                kit ? "text-white/45" : "text-ada-disabled",
              )}
              aria-hidden
            />
            <input
              type="url"
              className={cn(
                "flex-1 bg-transparent text-sm outline-none",
                kit
                  ? "text-white placeholder:text-white/45"
                  : "text-ada-primary placeholder:text-ada-disabled",
              )}
              placeholder="https://youtube.com/watch?v=… or article URL"
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              disabled={loading || refinementActive}
            />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 py-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={loading || refinementActive}
              className={cn(
                "flex items-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-sm transition-colors",
                kit
                  ? "border-white/35 bg-white/5 text-white/90 hover:border-white/55 hover:bg-white/10"
                  : "rounded-ada-input border-ada-border-active bg-ada-elevated text-ada-accent-hover hover:border-ada-accent",
              )}
            >
              <Paperclip className="h-4 w-4" aria-hidden />
              {uploadFile ? uploadFile.name : `Upload file (max ${maxUploadMb}MB)`}
            </button>
            {uploadFile ? (
              <button
                type="button"
                onClick={() => onFileChange(null)}
                className={cn(
                  "text-xs transition-colors",
                  kit ? "text-white/50 hover:text-red-300" : "text-ada-disabled hover:text-ada-error",
                )}
              >
                Remove
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              accept=".flac,.m4a,.mp3,.mp4,.mpeg,.mpga,.mov,.m4v,.oga,.ogg,.wav,.webm,.txt,.md,.markdown,.csv,.srt,.vtt,.json"
              disabled={loading || refinementActive}
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />
          </div>
        )}
      </div>

      <div
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-2.5",
          kit ? "border-t border-white/12" : "border-t border-ada-border",
        )}
      >
        <div className="flex flex-wrap gap-1.5">
          {PRESET_CHIPS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              disabled={loading || refinementActive}
              onClick={() => onPresetChange(preset === id ? null : id)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-all",
                kit &&
                  (preset === id
                    ? cn(MAGENTA_BTN, "text-white")
                    : "border border-white/28 bg-transparent text-white/75 hover:border-white/45 hover:bg-white/10 hover:text-white"),
                !kit &&
                  (preset === id
                    ? "bg-ada-accent text-white"
                    : "rounded-ada-pill border border-ada-border bg-transparent text-ada-secondary hover:border-ada-border-active hover:text-ada-primary"),
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={loading || !canSubmit || refinementActive}
          onClick={onSubmit}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all",
            canSubmit && !loading && !refinementActive
              ? kit
                ? cn(MAGENTA_BTN, "text-white hover:scale-105")
                : "bg-linear-to-br from-[#7B5CFA] to-[#9B6FFF] text-white shadow-lg shadow-[#7B5CFA33] hover:scale-105 hover:shadow-[#7B5CFA55]"
              : kit
                ? "cursor-not-allowed bg-white/10 text-white/35"
                : "cursor-not-allowed bg-ada-border text-ada-disabled",
          )}
          aria-label={
            loading
              ? "Generating"
              : refinementActive
                ? "Answer questions below"
                : "Continue to refinement"
          }
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
