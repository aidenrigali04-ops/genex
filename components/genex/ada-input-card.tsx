"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2 } from "lucide-react";

import type { ClipInputMode } from "@/lib/clip-package";
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

const KIT_SELECTED_TAB =
  "bg-[var(--ada-accent)] text-white shadow-md shadow-[var(--ada-accent)]/25";
const KIT_SELECTED_MODEL =
  "bg-[var(--ada-accent)] text-white shadow-md shadow-[var(--ada-accent)]/25";

/** `null` = YouTube-first (URL field only; no secondary path). */
export type AdaInputSecondaryTab = "upload" | "podcast" | "scratch" | null;

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
  /** Drives clip-package section ordering in the output surface. */
  onClipInputModeChange?: (mode: ClipInputMode) => void;
  /** Parent or network error — always shown in a dismissible-style banner when set. */
  errorMessage?: string | null;
  /** Credits charged for the primary clip-package action (default 1). */
  clipPackageCreditCost?: number;
};

function secondaryTabFromInputMode(
  mode: "text" | "url" | "file",
): AdaInputSecondaryTab {
  if (mode === "text") return "scratch";
  if (mode === "file") return "upload";
  return null;
}

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
  onClipInputModeChange,
  errorMessage = null,
  clipPackageCreditCost = 1,
}: AdaInputCardProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const kit = variant === "adaKit";
  const [secondaryTab, setSecondaryTab] = useState<AdaInputSecondaryTab>(() =>
    secondaryTabFromInputMode(inputMode),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setSecondaryTab(secondaryTabFromInputMode(inputMode));
  }, [inputMode]);

  useEffect(() => {
    if (!onClipInputModeChange) return;
    const clipMode: ClipInputMode =
      secondaryTab === "scratch" ? "generate_first" : "clip_first";
    onClipInputModeChange(clipMode);
  }, [secondaryTab, onClipInputModeChange]);

  useEffect(() => {
    if (secondaryTab === "scratch") {
      onInputModeChange("text");
    } else if (secondaryTab === "upload" || secondaryTab === "podcast") {
      onInputModeChange("file");
    } else {
      onInputModeChange("url");
    }
  }, [secondaryTab, onInputModeChange]);

  const displayedError = errorMessage ?? localError;

  const pickSecondaryTab = (tab: AdaInputSecondaryTab) => {
    setLocalError(null);
    setSecondaryTab(tab);
    if (tab === "scratch") {
      onUrlChange("");
      onFileChange(null);
    } else if (tab === null) {
      onFileChange(null);
      onTextChange("");
    } else if (tab === "upload" || tab === "podcast") {
      onUrlChange("");
      onTextChange("");
    }
  };

  const handleSubmit = () => {
    setLocalError(null);
    try {
      onSubmit();
    } catch (e) {
      setLocalError(
        e instanceof Error ? e.message : "Something went wrong. Try again.",
      );
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (canSubmit && !loading && !refinementActive) handleSubmit();
    }
  };

  const creditLabel =
    secondaryTab === "scratch"
      ? `Generate clip package · ${clipPackageCreditCost} credit${clipPackageCreditCost === 1 ? "" : "s"}`
      : `Find clips · ${clipPackageCreditCost} credit${clipPackageCreditCost === 1 ? "" : "s"}`;

  const fileAccept =
    secondaryTab === "podcast"
      ? ".flac,.m4a,.mp3,.mp4,.mpeg,.mpga,.mov,.m4v,.oga,.ogg,.wav,.webm"
      : ".flac,.m4a,.mp3,.mp4,.mpeg,.mpga,.mov,.m4v,.oga,.ogg,.wav,.webm,.txt,.md,.markdown,.csv,.srt,.vtt,.json";

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
          "flex items-center justify-end gap-2 px-3 py-2",
          kit ? "border-b border-white/12" : "border-b border-ada-border",
        )}
      >
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
                    ? cn(KIT_SELECTED_MODEL, "text-white")
                    : "text-white/50 hover:text-white/80"),
                !kit &&
                  (selectedModel === m.id
                    ? "bg-[var(--ada-accent)] text-white"
                    : "text-[var(--ada-text-disabled)] hover:text-[var(--ada-text-secondary)]"),
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div>
          <label
            className={cn(
              "mb-1.5 block text-[11px] font-medium",
              kit ? "text-white/55" : "text-[var(--ada-text-secondary)]",
            )}
            htmlFor="ada-youtube-url"
          >
            YouTube
          </label>
          <input
            id="ada-youtube-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            aria-label="YouTube video URL"
            placeholder="Paste a YouTube link — GenEx finds your best clips"
            value={url}
            onChange={(e) => {
              setLocalError(null);
              onUrlChange(e.target.value);
            }}
            disabled={
              loading ||
              refinementActive ||
              secondaryTab === "scratch" ||
              secondaryTab === "upload" ||
              secondaryTab === "podcast"
            }
            className={cn(
              "w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ada-accent)]/35",
              kit
                ? "border-white/18 bg-white/[0.04] text-white placeholder:text-white/45 disabled:opacity-45"
                : "border-[var(--ada-border)] bg-[var(--ada-bg-input)] text-[var(--ada-text-primary)] placeholder:text-[var(--ada-text-disabled)] disabled:opacity-45",
            )}
          />
        </div>

        <div className="space-y-1.5">
          <div
            className={cn(
              "flex flex-wrap gap-1",
              kit ? "border-t border-white/10 pt-2" : "border-t border-ada-border pt-2",
            )}
            role="tablist"
            aria-label="Other ways to start"
          >
            {(
              [
                { id: "upload" as const, label: "Pull clips from an upload" },
                {
                  id: "podcast" as const,
                  label: "Turn audio or a podcast into clips",
                },
                { id: "scratch" as const, label: "Start from a written idea" },
              ] satisfies { id: Exclude<AdaInputSecondaryTab, null>; label: string }[]
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={secondaryTab === id}
                disabled={loading || refinementActive}
                onClick={() => pickSecondaryTab(id)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium leading-snug transition-colors",
                  kit &&
                    (secondaryTab === id
                      ? cn(KIT_SELECTED_TAB)
                      : "text-white/60 hover:bg-white/10 hover:text-white"),
                  !kit &&
                    (secondaryTab === id
                      ? "bg-ada-accent-subtle text-ada-accent-hover"
                      : "text-ada-secondary hover:bg-ada-elevated hover:text-ada-primary"),
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {secondaryTab !== null ? (
            <button
              type="button"
              disabled={loading || refinementActive}
              onClick={() => pickSecondaryTab(null)}
              className={cn(
                "text-left text-[10px] font-medium underline-offset-2 hover:underline",
                kit ? "text-white/45 hover:text-white/70" : "text-ada-disabled hover:text-ada-secondary",
              )}
            >
              Use YouTube link only
            </button>
          ) : null}
        </div>

        {secondaryTab === "scratch" ? (
          <textarea
            className={cn(
              "min-h-[96px] w-full resize-none rounded-xl border px-3 py-2.5 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-[var(--ada-accent)]/35",
              kit
                ? "border-white/18 bg-white/[0.04] text-white placeholder:text-white/45"
                : "border-[var(--ada-border)] bg-transparent text-[var(--ada-text-primary)] placeholder:text-[var(--ada-text-disabled)]",
            )}
            placeholder="Drop your transcript, article, idea, or notes… ⌘↵ to generate"
            value={text}
            onChange={(e) => {
              setLocalError(null);
              onTextChange(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            disabled={loading || refinementActive}
          />
        ) : null}

        {secondaryTab === "upload" || secondaryTab === "podcast" ? (
          <div className="space-y-2">
            <p
              className={cn(
                "text-[11px] leading-relaxed",
                kit ? "text-white/50" : "text-[var(--ada-text-secondary)]",
              )}
            >
              {secondaryTab === "podcast"
                ? "Upload audio or video; we normalize to Whisper-friendly audio (see server transcode-for-whisper + source-from-upload)."
                : "Upload video or a text transcript file. Video/audio is processed for transcription the same way as podcast uploads."}
            </p>
            <div className="flex flex-wrap items-center gap-3 py-1">
              <button
                type="button"
                onClick={() => {
                  try {
                    fileRef.current?.click();
                  } catch (e) {
                    setLocalError(
                      e instanceof Error
                        ? e.message
                        : "Could not open file picker.",
                    );
                  }
                }}
                disabled={loading || refinementActive}
                className={cn(
                  "flex items-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-sm transition-colors",
                  kit
                    ? "border-white/35 bg-white/5 text-white/90 hover:border-white/55 hover:bg-white/10"
                    : "rounded-ada-input border-[var(--ada-border-active)] bg-[var(--ada-bg-elevated)] text-[var(--ada-accent-hover)] hover:border-[var(--ada-accent)]",
                )}
              >
                {uploadFile ? uploadFile.name : `Choose file (max ${maxUploadMb}MB)`}
              </button>
              {uploadFile ? (
                <button
                  type="button"
                  onClick={() => onFileChange(null)}
                  className={cn(
                    "text-xs transition-colors",
                    kit
                      ? "text-white/50 hover:text-red-300"
                      : "text-[var(--ada-text-disabled)] hover:text-[var(--ada-error)]",
                  )}
                >
                  Remove
                </button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                className="sr-only"
                accept={fileAccept}
                disabled={loading || refinementActive}
                onChange={(e) => {
                  try {
                    onFileChange(e.target.files?.[0] ?? null);
                  } catch (err) {
                    setLocalError(
                      err instanceof Error
                        ? err.message
                        : "Could not read that file.",
                    );
                  }
                }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {displayedError ? (
        <div
          className={cn(
            "mx-4 mb-2 rounded-lg border px-3 py-2 text-sm",
            kit
              ? "border-[var(--ada-error)]/40 bg-[var(--ada-error)]/15 text-red-50"
              : "border-[var(--ada-error)]/30 bg-[var(--ada-error)]/10 text-[var(--ada-error)]",
          )}
          role="alert"
        >
          {displayedError}
        </div>
      ) : null}

      <div
        className={cn(
          "flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between",
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
                    ? cn(KIT_SELECTED_TAB)
                    : "border border-white/28 bg-transparent text-white/75 hover:border-white/45 hover:bg-white/10 hover:text-white"),
                !kit &&
                  (preset === id
                    ? "bg-[var(--ada-accent)] text-white"
                    : "rounded-ada-pill border border-[var(--ada-border)] bg-transparent text-[var(--ada-text-secondary)] hover:border-[var(--ada-border-active)] hover:text-[var(--ada-text-primary)]"),
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={loading || !canSubmit || refinementActive}
          onClick={handleSubmit}
          aria-label="Generate clip package"
          className={cn(
            "inline-flex min-h-10 w-full shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-opacity sm:w-auto sm:min-w-[200px]",
            canSubmit && !loading && !refinementActive
              ? "bg-[var(--ada-accent)] hover:bg-[var(--ada-accent-hover)] hover:opacity-95 active:scale-[0.99]"
              : "cursor-not-allowed bg-[var(--ada-border)] opacity-55",
          )}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          ) : null}
          <span>{creditLabel}</span>
        </button>
      </div>
    </div>
  );
}
