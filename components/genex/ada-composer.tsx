"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Link2, Paperclip, StopCircle, Upload, X } from "lucide-react";

import type { GenerationPresetId } from "@/lib/generation-presets";
import { cn } from "@/lib/utils";

const PRESET_CHIPS: { id: GenerationPresetId; label: string; emoji: string }[] = [
  { id: "viral_hook", label: "Viral Hook", emoji: "⚡" },
  { id: "storytime", label: "Story", emoji: "📖" },
  { id: "educational", label: "Educational", emoji: "💡" },
  { id: "contrarian", label: "Contrarian", emoji: "🔥" },
];

const PLACEHOLDERS = [
  "Paste a YouTube URL, article, or your own idea…",
  "Drop a transcript and I'll turn it into clips…",
  "What do you want to create today?",
  "Paste your hook idea, story, or content brief…",
];

const MODELS = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "claude-sonnet", label: "Claude" },
  { id: "perplexity", label: "Research" },
];

export type AdaComposerProps = {
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
  onStop: () => void;
  maxUploadMb: number;
  variant?: "default" | "adaKit";
  refinementActive?: boolean;
  /** When refinement is active, allow submit from the main bar (host wires send). */
  refinementCanSend?: boolean;
  composerPlaceholder?: string;
};

export function AdaComposer({
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
  onStop,
  maxUploadMb,
  variant = "default",
  refinementActive = false,
  refinementCanSend = false,
  composerPlaceholder,
}: AdaComposerProps) {
  const kit = variant === "adaKit";
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Deterministic on SSR + first client paint; rotate after mount only (avoids hydration mismatch). */
  const [phIndex, setPhIndex] = useState(0);
  useEffect(() => {
    queueMicrotask(() => {
      setPhIndex(Math.floor(Math.random() * PLACEHOLDERS.length));
    });
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 5 * 24)}px`;
  }, [text]);

  useEffect(() => {
    if (!loading && (!refinementActive || refinementCanSend)) {
      textareaRef.current?.focus();
    }
  }, [loading, refinementActive, refinementCanSend]);

  const canSendFromBar =
    refinementActive && refinementCanSend ? true : canSubmit && !refinementActive;

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSendFromBar && !loading) onSubmit();
    }
  };

  const placeholder = composerPlaceholder ?? PLACEHOLDERS[phIndex % PLACEHOLDERS.length];

  return (
    <div className="space-y-2">
      {!loading ? (
        <div className="flex flex-wrap gap-1.5 px-1">
          {PRESET_CHIPS.map(({ id, label, emoji }) => (
            <button
              key={id}
              type="button"
              onClick={() => onPresetChange(preset === id ? null : id)}
              className={cn(
                "flex items-center gap-1 rounded-[999px] px-3 py-1 text-xs font-medium transition-all",
                preset === id
                  ? kit
                    ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white shadow-md shadow-[#8800DC33]"
                    : "bg-[var(--ada-accent)] text-white shadow-md shadow-[var(--ada-accent)]/30"
                  : kit
                    ? "border border-white/18 bg-white/[0.06] text-white/75 hover:border-white/32 hover:text-white"
                    : "border border-[var(--ada-border)] bg-[var(--ada-bg-card)] text-[var(--ada-text-secondary)] hover:border-[var(--ada-border-active)] hover:text-[var(--ada-text-primary)]",
              )}
            >
              <span>{emoji}</span>
              {label}
            </button>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "rounded-[16px] border bg-[var(--ada-bg-card)] transition-colors",
          kit && "bg-white/[0.06]",
          loading
            ? kit
              ? "border-white/35"
              : "border-[var(--ada-accent)]/40"
            : kit
              ? "border-white/14 focus-within:border-white/35"
              : "border-[var(--ada-border)] focus-within:border-[var(--ada-border-active)]",
        )}
      >
        {inputMode === "url" ? (
          <div
            className={cn(
              "flex items-center gap-2 border-b px-4 py-2.5",
              kit ? "border-white/10" : "border-[var(--ada-border)]",
            )}
          >
            <Link2
              className={cn(
                "h-4 w-4 shrink-0",
                kit ? "text-[#E8B4FF]" : "text-[var(--ada-accent)]",
              )}
            />
            <input
              type="url"
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="https://youtube.com/watch?v=…"
              disabled={loading}
              className={cn(
                "flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--ada-text-disabled)]",
                kit ? "text-white placeholder:text-white/40" : "text-[var(--ada-text-primary)]",
              )}
            />
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                onInputModeChange("text");
                onUrlChange("");
              }}
              className={cn(
                kit ? "text-white/40 hover:text-white/70" : "text-[var(--ada-text-disabled)] hover:text-[var(--ada-text-secondary)]",
              )}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {inputMode === "file" && uploadFile ? (
          <div
            className={cn(
              "flex items-center gap-2 border-b px-4 py-2.5",
              kit ? "border-white/10" : "border-[var(--ada-border)]",
            )}
          >
            <Paperclip
              className={cn(
                "h-4 w-4 shrink-0",
                kit ? "text-[#E8B4FF]" : "text-[var(--ada-accent)]",
              )}
            />
            <span
              className={cn(
                "flex-1 truncate text-sm",
                kit ? "text-white" : "text-[var(--ada-text-primary)]",
              )}
            >
              {uploadFile.name}
            </span>
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                onFileChange(null);
                onInputModeChange("text");
              }}
              className={cn(
                kit
                  ? "text-white/40 hover:text-red-300"
                  : "text-[var(--ada-text-disabled)] hover:text-[var(--ada-error)]",
              )}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        <div className="flex items-end gap-2 px-4 py-3">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              inputMode === "url" ? "Add context (optional)…" : placeholder
            }
            disabled={loading}
            className={cn(
              "min-h-[24px] flex-1 resize-none overflow-hidden bg-transparent text-sm leading-6 outline-none disabled:opacity-50 placeholder:text-[var(--ada-text-disabled)]",
              kit ? "text-white placeholder:text-white/40" : "text-[var(--ada-text-primary)]",
            )}
          />

          <button
            type="button"
            onClick={loading ? onStop : onSubmit}
            disabled={!loading && !canSendFromBar}
            className={cn(
              "mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all",
              loading
                ? kit
                  ? "bg-red-500/90 text-white hover:opacity-90"
                  : "bg-[var(--ada-error)] text-white hover:opacity-80"
                : canSendFromBar
                  ? kit
                    ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white shadow-md hover:scale-105"
                    : "bg-gradient-to-br from-[#7B5CFA] to-[#9B6FFF] text-white shadow-md shadow-[#7B5CFA33] hover:scale-105"
                  : kit
                    ? "cursor-not-allowed bg-white/10 text-white/35"
                    : "cursor-not-allowed bg-[var(--ada-border)] text-[var(--ada-text-disabled)]",
            )}
          >
            {loading ? (
              <StopCircle className="h-4 w-4" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>

        <div
          className={cn(
            "flex items-center justify-between gap-2 border-t px-3 py-2",
            kit ? "border-white/10" : "border-[var(--ada-border)]",
          )}
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onInputModeChange("url")}
              disabled={loading}
              className={cn(
                "flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-xs transition-colors",
                inputMode === "url"
                  ? kit
                    ? "bg-white/12 text-[#E8B4FF]"
                    : "bg-[var(--ada-accent-subtle)] text-[var(--ada-accent-hover)]"
                  : kit
                    ? "text-white/45 hover:text-white/75"
                    : "text-[var(--ada-text-disabled)] hover:text-[var(--ada-text-secondary)]",
              )}
            >
              <Link2 className="h-3.5 w-3.5" />
              URL
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              className={cn(
                "flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-xs transition-colors",
                inputMode === "file"
                  ? kit
                    ? "bg-white/12 text-[#E8B4FF]"
                    : "bg-[var(--ada-accent-subtle)] text-[var(--ada-accent-hover)]"
                  : kit
                    ? "text-white/45 hover:text-white/75"
                    : "text-[var(--ada-text-disabled)] hover:text-[var(--ada-text-secondary)]",
              )}
            >
              <Upload className="h-3.5 w-3.5" />
              File
            </button>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              accept=".flac,.m4a,.mp3,.mp4,.mpeg,.mpga,.mov,.m4v,.oga,.ogg,.wav,.webm,.txt,.md,.csv,.srt,.vtt,.json"
              disabled={loading}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f) {
                  onFileChange(f);
                  onInputModeChange("file");
                }
              }}
            />
          </div>

          <span
            className={cn(
              "hidden text-[10px] sm:inline",
              kit ? "text-white/35" : "text-[var(--ada-text-disabled)]",
            )}
          >
            Max {maxUploadMb} MB
          </span>

          <div className="flex items-center gap-0.5 sm:gap-1">
            {MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onModelChange(m.id)}
                disabled={loading}
                className={cn(
                  "rounded-[6px] px-1.5 py-1 text-[10px] font-medium transition-colors sm:px-2",
                  selectedModel === m.id
                    ? kit
                      ? "bg-white/20 text-white"
                      : "bg-[var(--ada-accent)] text-white"
                    : kit
                      ? "text-white/45 hover:text-white/75"
                      : "text-[var(--ada-text-disabled)] hover:text-[var(--ada-text-secondary)]",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
