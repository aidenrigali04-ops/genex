"use client";

import type { GenerationUiStep } from "@/lib/generation-stream-protocol";
import { cn } from "@/lib/utils";

type Props = {
  inputMode: "text" | "url" | "file";
  /** Short summary of what the user is working from (draft). */
  inputSummary: string;
  streamedText: string;
  verticalPreviewText: string;
  loading: boolean;
  fetchingYoutubeTranscript: boolean;
  generationSteps: GenerationUiStep[];
  getElapsed: (ts?: number) => string | null;
};

function GenexOrb() {
  return (
    <div
      className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-[#7c3aed] to-[#d946ef] text-xs font-bold text-white shadow-md"
      aria-hidden
    >
      G
    </div>
  );
}

export function ClipWorkspaceConversation({
  inputMode,
  inputSummary,
  streamedText,
  verticalPreviewText,
  loading,
  fetchingYoutubeTranscript,
  generationSteps,
  getElapsed,
}: Props) {
  const hasDraft = Boolean(inputSummary.trim());
  const hasOutput = Boolean(streamedText.trim());
  const showAssistant = loading || hasOutput;

  return (
    <div className="flex min-h-[200px] flex-col gap-5">
      {!hasDraft && !showAssistant ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-12 text-center">
          <p className="text-sm font-medium text-[#6B6B8A] dark:text-zinc-400">
            Ask anything…
          </p>
          <p className="max-w-sm text-xs leading-relaxed text-[#9B8EC4] dark:text-zinc-500">
            Describe your clip idea below. Your thread appears here while we
            generate your package.
          </p>
        </div>
      ) : null}

      {hasDraft ? (
        <div className="flex justify-end">
          <div
            className={cn(
              "max-w-[min(100%,520px)] rounded-2xl rounded-br-md border border-black/6 bg-white px-4 py-3 shadow-sm",
              "dark:border-white/10 dark:bg-zinc-900/90",
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9B8EC4] dark:text-zinc-500">
              You
            </p>
            <p className="mt-1 text-sm leading-relaxed text-[#1a1030] dark:text-zinc-100">
              {inputMode === "file" ? inputSummary : inputSummary.slice(0, 2000)}
              {inputMode !== "file" && inputSummary.length > 2000 ? "…" : ""}
            </p>
          </div>
        </div>
      ) : null}

      {showAssistant ? (
        <div className="flex justify-start gap-3">
          <GenexOrb />
          <div
            className={cn(
              "min-w-0 max-w-[min(100%,560px)] flex-1 rounded-2xl rounded-bl-md border border-black/6 bg-white px-4 py-3 shadow-sm",
              "dark:border-white/10 dark:bg-zinc-900/90",
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9B8EC4] dark:text-zinc-500">
              GenEx
            </p>
            {loading && !hasOutput ? (
              <div className="mt-3 space-y-2">
                <div className="h-2.5 w-full max-w-[280px] animate-pulse rounded-full bg-violet-100 dark:bg-violet-950/80" />
                <div className="h-2.5 w-full max-w-[220px] animate-pulse rounded-full bg-violet-50 dark:bg-zinc-800" />
                <div className="h-2.5 w-full max-w-[180px] animate-pulse rounded-full bg-violet-50 dark:bg-zinc-800" />
                <p className="pt-2 text-xs text-[#6B6B8A] dark:text-zinc-400">
                  {fetchingYoutubeTranscript
                    ? "Fetching captions…"
                    : generationSteps.at(-1)?.label ?? "Generating your clip package…"}
                </p>
              </div>
            ) : (
              <pre
                className={cn(
                  "mt-2 max-h-[min(38vh,320px)] overflow-y-auto font-sans text-sm leading-relaxed whitespace-pre-wrap wrap-break-word text-[#1a1030] dark:text-zinc-100",
                  loading && streamedText.trim() && "genex-shimmer rounded-md",
                )}
              >
                {verticalPreviewText.trim()
                  ? verticalPreviewText
                  : streamedText.trim().slice(0, 4000)}
              </pre>
            )}
            {generationSteps.length > 0 && loading ? (
              <ol className="mt-3 max-h-28 list-none space-y-0.5 overflow-y-auto border-t border-black/5 pt-2 text-[11px] dark:border-white/10">
                {generationSteps.map((s, i) => (
                  <li
                    key={`${s.id}-${i}`}
                    className={cn(
                      "flex items-center gap-2 py-0.5",
                      i === generationSteps.length - 1
                        ? "font-medium text-[#1a1030] dark:text-zinc-200"
                        : "text-[#6B6B8A] dark:text-zinc-500",
                    )}
                  >
                    <span className="w-4 shrink-0 tabular-nums opacity-70">
                      {i + 1}.
                    </span>
                    <span className="min-w-0 flex-1">{s.label}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-[#9B8EC4] dark:text-zinc-600">
                      {getElapsed(s.ts) ?? ""}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
