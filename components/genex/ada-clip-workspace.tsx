"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Link2, Paperclip } from "lucide-react";

import { AdaComposer } from "@/components/genex/ada-composer";
import { AdaEmptyState } from "@/components/genex/ada-empty-state";
import { FirstGenCelebration } from "@/components/genex/first-gen-celebration";
import { AdaLiveTurn } from "@/components/genex/ada-live-turn";
import { AdaTurn } from "@/components/genex/ada-turn";
import {
  RefinementChatPanel,
  type RemoteRefinementState,
} from "@/components/refinement-chat-panel";
import type { GenerationContextV1 } from "@/lib/generation-context";
import type { GenerationPresetId } from "@/lib/generation-presets";
import type { ClipTurn, LiveClipTurnSnapshot } from "@/lib/clip-turn";
import type { ClipInputMode } from "@/lib/clip-package";
import type { PlatformId } from "@/lib/platforms";
import type { GenerationUiStep } from "@/lib/generation-stream-protocol";
import { trackAha } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { AdaSidebarVoiceProfile } from "@/components/genex/ada-sidebar";
import {
  AdaVoiceProfileModal,
  type VoiceProfileData,
} from "@/components/genex/ada-voice-profile-modal";

export type AdaClipWorkspaceProps = {
  turns: ClipTurn[];
  liveTurnSnapshot: LiveClipTurnSnapshot | null;
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
  generationSteps: GenerationUiStep[];
  getElapsed: (ts?: number) => string | null;
  error: string | null;
  fetchingYoutubeTranscript: boolean;
  progress: number;
  streamedText: string;
  copiedId: string | null;
  onCopy: (id: string, body: string) => void | Promise<void>;
  onRegenerate: () => void;
  variant?: "default" | "adaKit";
  onTextVideoCreditsRemainingChange?: (remaining: number) => void;
  refinementOpen?: boolean;
  refinementPlatformIds?: PlatformId[];
  refinementInputSummary?: string;
  onRefinementConfirm?: (ctx: GenerationContextV1) => void;
  onRefinementCancel?: () => void;
  /** When set, panel uses async personalized steps instead of static templates. */
  refinementRemote?: RemoteRefinementState;
  refinementPlanKey?: string;
  refinementPrefillInference?: {
    inferredClipPurpose?: string;
    inferredPurposeRationale?: string;
  };
  onRefinementOpenTypedAnswer?: (fieldKey: string) => void;
  onExamplePrompt?: (prompt: string, mode: "text" | "url") => void;
  /** Refill composer from a completed turn (e.g. Remix). */
  onRemix?: (prompt: string) => void;
  /** For live-turn analytics + clip-first copy (optional). */
  authUserId?: string;
  onPreferIdeaFirst?: () => void;
  /** Parent sets true when the API marks first generation; ref prevents duplicate overlays. */
  showFirstGenCelebration?: boolean;
  /** Empty state: signed-in user with no prior clip packages yet. */
  emptyStateIsAuthenticated?: boolean;
  emptyStateHasGenerated?: boolean;
  isAuthenticated?: boolean;
  hasGenerated?: boolean;
  voiceProfile?: AdaSidebarVoiceProfile | null;
  voiceProfileOpen?: boolean;
  onVoiceProfileOpenChange?: (open: boolean) => void;
  onSaveVoiceProfile?: (data: VoiceProfileData) => Promise<void>;
};

export function AdaClipWorkspace({
  turns,
  liveTurnSnapshot,
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
  generationSteps,
  getElapsed,
  error,
  fetchingYoutubeTranscript,
  progress,
  streamedText,
  copiedId,
  onCopy,
  onRegenerate,
  variant = "default",
  onTextVideoCreditsRemainingChange,
  refinementOpen = false,
  refinementPlatformIds = ["clip_package"],
  refinementInputSummary = "",
  onRefinementConfirm,
  onRefinementCancel,
  refinementRemote,
  refinementPlanKey = "",
  refinementPrefillInference,
  onRefinementOpenTypedAnswer,
  onExamplePrompt,
  onRemix,
  authUserId,
  onPreferIdeaFirst,
  showFirstGenCelebration = false,
  emptyStateIsAuthenticated = false,
  emptyStateHasGenerated = false,
  isAuthenticated: isAuthenticatedProp,
  hasGenerated: hasGeneratedProp,
  voiceProfile = null,
  voiceProfileOpen = false,
  onVoiceProfileOpenChange,
  onSaveVoiceProfile,
}: AdaClipWorkspaceProps) {
  const kit = variant === "adaKit";
  const isAuthenticated = isAuthenticatedProp ?? emptyStateIsAuthenticated;
  const hasGenerated = hasGeneratedProp ?? emptyStateHasGenerated;
  const supabase = useMemo(() => createClient(), []);
  const secondGenFiredRef = useRef(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const celebrationShownThisSession = useRef(false);
  const clipPackageInputMode: ClipInputMode =
    inputMode === "url" || inputMode === "file" ? "clip_first" : "generate_first";

  useEffect(() => {
    if (secondGenFiredRef.current) return;
    if (turns.length < 2) return;
    if (!authUserId?.trim()) return;
    secondGenFiredRef.current = true;
    void trackAha(supabase, authUserId, "second_generation", {
      totalTurns: turns.length,
    });
  }, [turns.length, authUserId, supabase]);

  useEffect(() => {
    if (showFirstGenCelebration && !celebrationShownThisSession.current) {
      celebrationShownThisSession.current = true;
      setShowCelebration(true);
    }
  }, [showFirstGenCelebration]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    turns,
    streamedText,
    loading,
    error,
    refinementOpen,
    liveTurnSnapshot,
    generationSteps.length,
  ]);

  const handleExampleClick = (prompt: string, mode: "text" | "url") => {
    onExamplePrompt?.(prompt, mode);
  };

  const liveUserBubble = liveTurnSnapshot && loading && (
    <div className="flex justify-end">
      <div
        className={cn(
          "max-w-[85%] rounded-[18px] rounded-br-[4px] border px-4 py-3",
          kit
            ? "border-white/14 bg-[linear-gradient(95deg,#D31CD7_0%,#8800DC_100%)] text-white shadow-[0_12px_28px_rgba(136,1,220,0.22)]"
            : "border-[var(--ada-border)] bg-[var(--ada-bg-elevated)]",
        )}
      >
        {liveTurnSnapshot.inputMode !== "text" ? (
          <div className="mb-2 flex items-center gap-1.5">
            {liveTurnSnapshot.inputMode === "url" ? (
              <Link2
                className={cn(
                  "h-3 w-3",
                  kit ? "text-white/90" : "text-[var(--ada-accent)]",
                )}
              />
            ) : (
              <Paperclip
                className={cn(
                  "h-3 w-3",
                  kit ? "text-white/90" : "text-[var(--ada-accent)]",
                )}
              />
            )}
            <span
              className={cn(
                "text-[10px] font-medium tracking-wide uppercase",
                kit ? "text-white/80" : "text-[var(--ada-accent)]",
              )}
            >
              {liveTurnSnapshot.inputMode}
            </span>
          </div>
        ) : null}
        <p
          className={cn(
            "text-sm leading-relaxed break-words",
            kit ? "text-white" : "text-[var(--ada-text-primary)]",
          )}
        >
          {liveTurnSnapshot.userMessage}
        </p>
        {liveTurnSnapshot.preset ? (
          <div className="mt-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                kit
                  ? "bg-white/20 text-white"
                  : "bg-[var(--ada-accent)]/20 text-[var(--ada-accent-hover)]",
              )}
            >
              {liveTurnSnapshot.preset.replace(/_/g, " ")}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 flex-col",
        kit
          ? "bg-[#0A050F] font-[family-name:var(--font-instrument-sans)] text-white"
          : "bg-[var(--ada-bg-app)]",
      )}
    >
      <div
        ref={threadRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
        style={{ scrollBehavior: "smooth" }}
      >
        <div
          className={cn(
            "mx-auto w-full max-w-3xl space-y-8 px-4 py-6",
            "pb-[180px]",
          )}
        >
          {turns.length === 0 && !loading && !refinementOpen ? (
            <AdaEmptyState
              variant={variant}
              onExampleClick={handleExampleClick}
              onPreferIdeaFirst={onPreferIdeaFirst}
              isAuthenticated={isAuthenticated}
              hasGenerated={hasGenerated}
            />
          ) : null}

          {turns.map((turn, i) => (
            <AdaTurn
              key={turn.id}
              turn={turn}
              isLast={i === turns.length - 1}
              copiedId={copiedId}
              onCopy={onCopy}
              onRegenerate={onRegenerate}
              onTextVideoCreditsRemainingChange={onTextVideoCreditsRemainingChange}
              variant={variant}
              onRemix={onRemix}
            />
          ))}

          {refinementOpen && !loading && onRefinementConfirm ? (
            <div className="w-full">
              <RefinementChatPanel
                active={refinementOpen}
                kind="text_generation"
                platformIds={refinementPlatformIds}
                inputSummary={refinementInputSummary}
                variant={variant}
                embedInChat
                className="max-h-none min-h-0"
                remoteRefinement={refinementRemote}
                refinementPlanKey={refinementPlanKey}
                prefillInference={refinementPrefillInference}
                onOpenTypedAnswer={onRefinementOpenTypedAnswer}
                onConfirm={onRefinementConfirm}
                onCancel={onRefinementCancel}
              />
            </div>
          ) : null}

          {liveUserBubble}

          {loading ? (
            <AdaLiveTurn
              streamedText={streamedText}
              generationSteps={generationSteps}
              progress={progress}
              fetchingYoutubeTranscript={fetchingYoutubeTranscript}
              getElapsed={getElapsed}
              copiedId={copiedId}
              onCopy={onCopy}
              variant={variant}
              inputMode={clipPackageInputMode}
              userId={authUserId}
              supabase={supabase}
            />
          ) : null}

          {error ? (
            <div
              className={cn(
                "rounded-[10px] border px-5 py-4 text-sm",
                kit
                  ? "border-red-400/35 bg-red-950/50 text-red-50"
                  : "border-[var(--ada-error)]/30 bg-[var(--ada-error)]/10 text-[var(--ada-error)]",
              )}
              role="alert"
            >
              {error}
            </div>
          ) : null}

          <div className="h-2 shrink-0" aria-hidden />
        </div>
      </div>

      <div
        className={cn(
          "absolute right-0 bottom-0 left-0 px-4 pt-6 pb-4",
          kit
            ? "bg-gradient-to-t from-[#0A050F] via-[#0A050F] to-transparent"
            : "bg-gradient-to-t from-[var(--ada-bg-app)] via-[var(--ada-bg-app)] to-transparent",
        )}
      >
        <div className="mx-auto w-full max-w-3xl">
          <AdaComposer
            inputMode={inputMode}
            onInputModeChange={onInputModeChange}
            text={text}
            onTextChange={onTextChange}
            url={url}
            onUrlChange={onUrlChange}
            uploadFile={uploadFile}
            onFileChange={onFileChange}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            preset={preset}
            onPresetChange={onPresetChange}
            loading={loading}
            canSubmit={canSubmit}
            onSubmit={onSubmit}
            onStop={onStop}
            maxUploadMb={maxUploadMb}
            variant={variant}
            refinementActive={refinementOpen}
          />
          <p
            className={cn(
              "mt-2 text-center text-[10px]",
              kit ? "text-white/35" : "text-[var(--ada-text-disabled)]",
            )}
          >
            GenEx can make mistakes. Review clips before posting.
          </p>
        </div>
      </div>

      {showCelebration ? (
        <FirstGenCelebration
          variant={variant}
          userId={authUserId}
          onDismiss={() => setShowCelebration(false)}
        />
      ) : null}

      <AdaVoiceProfileModal
        open={voiceProfileOpen}
        initial={
          voiceProfile
            ? {
                niche: voiceProfile.niche ?? undefined,
                tone_preference: voiceProfile.tone_preference ?? undefined,
                hook_style: voiceProfile.hook_style ?? undefined,
              }
            : null
        }
        onSave={async (data) => {
          await onSaveVoiceProfile?.(data);
        }}
        onClose={() => onVoiceProfileOpenChange?.(false)}
        variant={variant}
      />
    </div>
  );
}
