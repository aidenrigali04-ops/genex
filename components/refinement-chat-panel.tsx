"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  buildRefinementSteps,
  type RefinementKind,
  type RefinementStepDef,
} from "@/lib/refinement-steps";
import { refinementAnswersComplete } from "@/lib/refinement-conversation-prompt";
import {
  buildSummaryFromContext,
  GENERATION_CONTEXT_VERSION,
  sanitizeGenerationContextForTransport,
  type GenerationContextV1,
} from "@/lib/generation-context";
import { readGuestCreditsRemaining } from "@/lib/guest-credits";
import type { PlatformId } from "@/lib/platforms";
import { PLATFORM_BY_ID } from "@/lib/platforms";
import { cn } from "@/lib/utils";

function coachTextFromParts(message: UIMessage) {
  return message.parts
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

export type RemoteRefinementState =
  | { phase: "loading" }
  | { phase: "error"; message: string; onRetry: () => void }
  | { phase: "ready"; steps: RefinementStepDef[] };

export type ThreadEntry =
  | { id: string; role: "assistant"; text: string; source?: "scripted" | "llm" }
  | {
      id: string;
      role: "user";
      fieldKey: string;
      displayLabel: string;
      storedValue: string;
    };

/** Free-form user line in ChatGPT-style clip refinement (video_variations + embed). */
export type ConversationalRefinementMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const CLIP_CONVERSATION_WELCOME = `I'm Ada. Let's lock in how we should cut your five shorts — just chat naturally, no forms.

Tell me in your own words:
• About how long each cut should feel (or say you have no preference)
• What you're optimizing for (followers, a promo, entertainment, traffic…)
• Voiceover, bold on-screen captions, or a mix
• The hook vibe you like (curiosity, bold claim, story beat, etc.)

I'll reflect back what I understood and we can tweak until you're ready to generate.`;

export type RefinementChatPanelProps = {
  /** When true, the panel is shown and internal step state resets on activation. */
  active: boolean;
  kind: RefinementKind;
  platformIds: PlatformId[];
  inputSummary: string;
  onConfirm: (ctx: GenerationContextV1) => void;
  onCancel?: () => void;
  variant?: "default" | "adaKit";
  /** Optional header (e.g. dialog title). Omit for compact inline chrome. */
  title?: string;
  description?: string;
  className?: string;
  /** Hide top intro/header (use when an outer shell e.g. Dialog already shows title). */
  hideChrome?: boolean;
  /** Softer shell + omit duplicate input chip (shown as user bubble above in chat). */
  embedInChat?: boolean;
  /** Async personalized steps from parent; when omitted, uses static `buildRefinementSteps`. */
  remoteRefinement?: RemoteRefinementState;
  /** Bumps when the underlying input changes so step state resets. */
  refinementPlanKey?: string;
  /** Merged into confirmed `GenerationContextV1` (e.g. LLM-detected clip purpose). */
  prefillInference?: {
    inferredClipPurpose?: string;
    inferredPurposeRationale?: string;
  };
  /** Fires when the user submits a typed refinement answer (not a pill). */
  onOpenTypedAnswer?: (fieldKey: string) => void;
  /**
   * Latest draft `GenerationContextV1` while `active` (answers + optional niche).
   * Use for tooling (e.g. clip coach) before confirm; omit if not needed.
   */
  onDraftContextChange?: (ctx: GenerationContextV1) => void;
  /**
   * When true (default: same as `embedInChat`), show "Ask Ada" to call `/api/refinement-thread`
   * for clarifications. Uses one chat-style credit per request when signed in.
   */
  llmAssist?: boolean;
  /**
   * Clip My Video: merge clip_first coach (`/api/chat`) with conversational refinement in one panel.
   * Requires `clipCoachGenerationContext`, `clipCoachBriefPrefix`, `onApplyCoachToPrompt`.
   */
  unifiedClipCoach?: boolean;
  /** When false, only clip coach shows; when true, refinement thread + job setup appear below coach. */
  refinementActive?: boolean;
  clipCoachGenerationContext?: GenerationContextV1 | null;
  clipCoachBriefPrefix?: string;
  onApplyCoachToPrompt?: (text: string) => void;
  /** Bump to clear streaming coach history (e.g. New run). */
  clipCoachResetNonce?: number;
  /** Shown in unified clip coach chrome for guest-credit copy. */
  user?: { id: string; email: string } | null;
  /**
   * When set with embed + conversational clip (non-unified), host uses the main composer;
   * `current` is wired to send a user line. Panel hides its duplicate textarea.
   */
  conversationalSendRef?: MutableRefObject<((line: string) => Promise<void>) | null>;
  /** Lets host disable main-bar send while Ada is typing. */
  onConversationalBusyChange?: (busy: boolean) => void;
  /** No nested card / badge strip — flows as one thread with the host composer. */
  flatEmbedShell?: boolean;
  /**
   * When set with a signed-in `user`, each successful `/api/refinement-conversation` turn
   * upserts `clip_refinement_sessions` in Supabase (full `messages` payload for that turn).
   */
  persistenceSessionId?: string | null;
};

function platformLabels(ids: PlatformId[]): string {
  return ids.map((id) => PLATFORM_BY_ID[id]?.label ?? id).join(", ");
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function buildInterimContext(
  kind: RefinementKind,
  platformIds: PlatformId[],
  answers: Record<string, string>,
  prefillInference: RefinementChatPanelProps["prefillInference"],
): GenerationContextV1 {
  const purpose = prefillInference?.inferredClipPurpose?.trim();
  const rationale = prefillInference?.inferredPurposeRationale?.trim();
  return {
    version: GENERATION_CONTEXT_VERSION,
    kind: kind === "video_variations" ? "video_variations" : "text_generation",
    platforms: platformIds,
    answers: { ...answers },
    confirmedAt: new Date().toISOString(),
    ...(purpose ? { inferredClipPurpose: purpose } : {}),
    ...(rationale ? { inferredPurposeRationale: rationale } : {}),
  };
}

export function RefinementChatPanel({
  active,
  kind,
  platformIds,
  inputSummary,
  onConfirm,
  onCancel,
  variant = "default",
  title,
  description,
  className,
  hideChrome = false,
  embedInChat = false,
  remoteRefinement,
  refinementPlanKey = "",
  prefillInference,
  onOpenTypedAnswer,
  onDraftContextChange,
  llmAssist: llmAssistProp,
  unifiedClipCoach = false,
  refinementActive = true,
  clipCoachGenerationContext = null,
  clipCoachBriefPrefix = "",
  onApplyCoachToPrompt,
  clipCoachResetNonce = 0,
  user = null,
  conversationalSendRef,
  onConversationalBusyChange,
  flatEmbedShell = false,
  persistenceSessionId = null,
}: RefinementChatPanelProps) {
  const llmAssist = llmAssistProp ?? embedInChat;
  const kit = variant === "adaKit";
  const staticSteps = useMemo(
    () => buildRefinementSteps(kind, platformIds),
    [kind, platformIds],
  );

  const effectiveSteps =
    remoteRefinement?.phase === "ready"
      ? remoteRefinement.steps
      : staticSteps;

  const remoteLoading = remoteRefinement?.phase === "loading";
  const remoteError =
    remoteRefinement?.phase === "error" ? remoteRefinement : null;

  /** Clip My Video (embed): ChatGPT-style refinement only; wizard kept for other modes. */
  const conversationalClip =
    embedInChat &&
    kind === "video_variations" &&
    !remoteLoading &&
    !remoteError;

  const unifiedMode = conversationalClip && unifiedClipCoach;

  const externalConversationalComposer =
    Boolean(conversationalSendRef) && conversationalClip && !unifiedMode;
  const inlineMainThreadMode =
    conversationalClip &&
    externalConversationalComposer &&
    flatEmbedShell &&
    !unifiedMode;

  const coachGenRef = useRef<GenerationContextV1 | null>(null);
  const coachBriefRef = useRef("");
  useEffect(() => {
    coachGenRef.current = clipCoachGenerationContext;
  }, [clipCoachGenerationContext]);
  useEffect(() => {
    coachBriefRef.current = clipCoachBriefPrefix.trim();
  }, [clipCoachBriefPrefix]);

  const coachTransport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        credentials: "same-origin",
        body: () => ({
          inputMode: "clip_first" as const,
          generationContext: coachGenRef.current,
          guestCreditsRemaining: readGuestCreditsRemaining(),
        }),
      }),
    [],
  );

  const {
    messages: coachMsgs,
    sendMessage: sendCoachMessage,
    status: coachStatus,
    stop: stopCoach,
  } = useChat({
    id: `clip-coach-${clipCoachResetNonce}`,
    transport: coachTransport,
  });
  const coachBusy =
    coachStatus === "submitted" || coachStatus === "streaming";

  const totalSteps = effectiveSteps.length + 1;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customMode, setCustomMode] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const [summaryNiche, setSummaryNiche] = useState("");
  const [threadEntries, setThreadEntries] = useState<ThreadEntry[]>([]);
  const [optionalDetailDraft, setOptionalDetailDraft] = useState("");
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [pendingLlmPatches, setPendingLlmPatches] = useState<Record<
    string,
    string
  > | null>(null);
  const [convMsgs, setConvMsgs] = useState<ConversationalRefinementMsg[]>([]);
  const [convInput, setConvInput] = useState("");
  const [convBusy, setConvBusy] = useState(false);
  const [convErr, setConvErr] = useState<string | null>(null);
  const convEndRef = useRef<HTMLDivElement>(null);
  const openAnswerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  /** Dedupes auto-opening `/api/refinement-conversation` per plan (incl. StrictMode). */
  const refinementOpeningInflightKeyRef = useRef<string | null>(null);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  useEffect(() => {
    if (!active) return;
    queueMicrotask(() => {
      setStep(0);
      setAnswers({});
      setCustomMode(false);
      setCustomDraft("");
      setSummaryNiche("");
      setThreadEntries([]);
      setOptionalDetailDraft("");
      setLlmError(null);
      setPendingLlmPatches(null);
      setConvErr(null);
      if (!(conversationalClip && !unifiedMode)) {
        setConvMsgs([]);
        setConvInput("");
        setConvBusy(false);
      } else {
        setConvInput("");
      }
      if (conversationalClip && unifiedMode && refinementActive) {
        setConvMsgs([
          {
            id: newId(),
            role: "assistant",
            text: CLIP_CONVERSATION_WELCOME,
          },
        ]);
      }
    });
  }, [
    active,
    kind,
    platformIds,
    refinementPlanKey,
    conversationalClip,
    unifiedMode,
    refinementActive,
  ]);

  const prevRefinementActive = useRef(false);
  useEffect(() => {
    if (!unifiedMode || !conversationalClip) {
      prevRefinementActive.current = refinementActive;
      return;
    }
    if (refinementActive && !prevRefinementActive.current) {
      queueMicrotask(() => {
        setConvMsgs([
          {
            id: newId(),
            role: "assistant",
            text: CLIP_CONVERSATION_WELCOME,
          },
        ]);
        setAnswers({});
        setSummaryNiche("");
        setConvInput("");
        setConvErr(null);
        setConvBusy(false);
      });
    }
    prevRefinementActive.current = refinementActive;
  }, [refinementActive, unifiedMode, conversationalClip]);

  const isSummary = step >= effectiveSteps.length;
  const currentDef = !isSummary ? effectiveSteps[step] : null;
  const primaryOpenAnswer =
    !!currentDef &&
    currentDef.pills.length === 0 &&
    currentDef.allowCustom;

  const threadLen = threadEntries.length;
  useEffect(() => {
    if (conversationalClip) return;
    if (!active || remoteLoading || remoteError || effectiveSteps.length === 0)
      return;
    if (threadLen > 0) return;
    const first = effectiveSteps[0]!;
    const intro =
      kind === "video_variations"
        ? "Before we queue your five cuts, a few choices help the editor match length, goal, and delivery."
        : "To get the strongest clip package from your prompt, I need a bit of context first.";
    const text = `${intro}\n\n${first.message}`;
    setThreadEntries([{ id: newId(), role: "assistant", text, source: "scripted" }]);
  }, [
    active,
    conversationalClip,
    remoteLoading,
    remoteError,
    effectiveSteps,
    kind,
    threadLen,
  ]);

  useEffect(() => {
    if (!active || !primaryOpenAnswer || conversationalClip) return;
    queueMicrotask(() => openAnswerTextareaRef.current?.focus());
  }, [active, step, primaryOpenAnswer, currentDef?.id, conversationalClip]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [threadEntries, step, isSummary, llmBusy]);

  useEffect(() => {
    convEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [
    convMsgs,
    convBusy,
    conversationalClip,
    coachMsgs,
    coachBusy,
    unifiedMode,
    refinementActive,
  ]);

  const draftContext = useMemo((): GenerationContextV1 => {
    const merged = { ...answers };
    if (summaryNiche.trim()) merged.nicheTheme = summaryNiche.trim();
    const purpose = prefillInference?.inferredClipPurpose?.trim();
    const rationale = prefillInference?.inferredPurposeRationale?.trim();
    return {
      version: GENERATION_CONTEXT_VERSION,
      kind: kind === "video_variations" ? "video_variations" : "text_generation",
      platforms: platformIds,
      answers: merged,
      confirmedAt: new Date().toISOString(),
      ...(purpose ? { inferredClipPurpose: purpose } : {}),
      ...(rationale ? { inferredPurposeRationale: rationale } : {}),
    };
  }, [answers, summaryNiche, kind, platformIds, prefillInference]);

  useEffect(() => {
    if (!active || !onDraftContextChange) return;
    onDraftContextChange(draftContext);
  }, [active, draftContext, onDraftContextChange]);

  const appendSummaryAssistant = useCallback(
    (nextAnswers: Record<string, string>) => {
      const interim = buildInterimContext(
        kind,
        platformIds,
        nextAnswers,
        prefillInference,
      );
      const st = buildSummaryFromContext(interim);
      const tail =
        kind === "video_variations"
          ? "Review and confirm when you're ready."
          : "Review and confirm to generate.";
      const body = `Target: ${platformLabels(platformIds)}${st ? `\n\n${st}` : ""}\n\n${tail}`;
      return {
        id: newId(),
        role: "assistant" as const,
        text: body,
        source: "scripted" as const,
      };
    },
    [kind, platformIds, prefillInference],
  );

  const applyAnswer = useCallback(
    (fieldKey: string, value: string, displayLabel: string) => {
      const detail = optionalDetailDraft.trim();
      const stored = detail ? `${value}\n\n${detail}` : value;
      const next = { ...answersRef.current, [fieldKey]: stored };
      setAnswers(next);
      const fieldIndex = effectiveSteps.findIndex((s) => s.fieldKey === fieldKey);
      const userEntry: ThreadEntry = {
        id: newId(),
        role: "user",
        fieldKey,
        displayLabel,
        storedValue: stored,
      };
      setThreadEntries((prevThread) => {
        const nextThread = [...prevThread, userEntry];
        if (fieldIndex >= 0 && fieldIndex + 1 < effectiveSteps.length) {
          const nextDef = effectiveSteps[fieldIndex + 1]!;
          nextThread.push({
            id: newId(),
            role: "assistant",
            text: nextDef.message,
            source: "scripted",
          });
        } else {
          nextThread.push(appendSummaryAssistant(next));
        }
        return nextThread;
      });
      setOptionalDetailDraft("");
      setCustomMode(false);
      setCustomDraft("");
      setStep((s) => s + 1);
    },
    [effectiveSteps, optionalDetailDraft, appendSummaryAssistant],
  );

  const restartFromField = useCallback(
    (fieldKey: string) => {
      const fieldIndex = effectiveSteps.findIndex((s) => s.fieldKey === fieldKey);
      if (fieldIndex < 0) return;
      setThreadEntries((prev) => {
        const idx = prev.findIndex(
          (e) => e.role === "user" && e.fieldKey === fieldKey,
        );
        if (idx < 0) return prev;
        return prev.slice(0, idx);
      });
      setAnswers((prev) => {
        const next = { ...prev };
        for (let i = fieldIndex; i < effectiveSteps.length; i++) {
          const k = effectiveSteps[i]!.fieldKey;
          delete next[k];
        }
        return next;
      });
      setStep(fieldIndex);
      setCustomMode(false);
      setCustomDraft("");
      setOptionalDetailDraft("");
      setPendingLlmPatches(null);
      setLlmError(null);
    },
    [effectiveSteps],
  );

  const handlePill = (fieldKey: string, value: string, pillLabel: string) => {
    if (value === "__custom__") {
      setCustomMode(true);
      setCustomDraft("");
      return;
    }
    applyAnswer(fieldKey, value, pillLabel);
  };

  const handleCustomSubmit = useCallback(() => {
    if (!currentDef) return;
    const t = customDraft.trim();
    if (!t) return;
    onOpenTypedAnswer?.(currentDef.fieldKey);
    applyAnswer(currentDef.fieldKey, t, "Custom answer");
  }, [applyAnswer, currentDef, customDraft, onOpenTypedAnswer]);

  const handleConfirmGenerate = () => {
    onConfirm(sanitizeGenerationContextForTransport(draftContext));
  };

  const goBackToQuestions = () => {
    setStep(0);
    setAnswers({});
    setCustomMode(false);
    setCustomDraft("");
    setSummaryNiche("");
    setThreadEntries([]);
    setOptionalDetailDraft("");
    setPendingLlmPatches(null);
    setLlmError(null);
    setConvMsgs([]);
    setConvInput("");
    setConvErr(null);
    setConvBusy(false);
    refinementOpeningInflightKeyRef.current = null;
  };

  const callRefinementConversationApi = useCallback(
    async (messages: { role: "user" | "assistant"; content: string }[]) => {
      const res = await fetch("/api/refinement-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          kind,
          platformIds,
          inputSummary,
          messages,
          answersPartial: answersRef.current,
          guestCreditsRemaining: readGuestCreditsRemaining(),
          ...(user?.id && persistenceSessionId?.trim()
            ? { sessionId: persistenceSessionId.trim() }
            : {}),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        assistantMessage?: string;
        answerPatches?: Record<string, string>;
      };
      if (!res.ok) throw new Error(data.error || "Request failed");
      const msg = data.assistantMessage?.trim();
      if (!msg) throw new Error("Empty response");
      return { msg, patches: data.answerPatches };
    },
    [kind, platformIds, inputSummary, user?.id, persistenceSessionId],
  );

  const sendConversationalLine = useCallback(
    async (line: string) => {
      const t = line.trim();
      if (!t || convBusy || !conversationalClip) return;
      const userLine: ConversationalRefinementMsg = {
        id: newId(),
        role: "user",
        text: t,
      };
      const history: { role: "user" | "assistant"; content: string }[] = [
        ...convMsgs.map((m) => ({ role: m.role, content: m.text })),
        { role: "user", content: t },
      ];
      setConvMsgs((prev) => [...prev, userLine]);
      setConvBusy(true);
      setConvErr(null);
      try {
        const { msg, patches } = await callRefinementConversationApi(history);
        setConvMsgs((prev) => [
          ...prev,
          { id: newId(), role: "assistant", text: msg },
        ]);
        if (patches && Object.keys(patches).length > 0) {
          setAnswers((prev) => ({ ...prev, ...patches }));
        }
      } catch (e) {
        setConvErr(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setConvBusy(false);
      }
    },
    [
      convBusy,
      conversationalClip,
      convMsgs,
      callRefinementConversationApi,
    ],
  );

  useEffect(() => {
    if (!conversationalSendRef || !externalConversationalComposer) {
      if (conversationalSendRef) conversationalSendRef.current = null;
      return;
    }
    conversationalSendRef.current = async (line: string) => {
      await sendConversationalLine(line);
    };
    return () => {
      conversationalSendRef.current = null;
    };
  }, [
    conversationalSendRef,
    externalConversationalComposer,
    sendConversationalLine,
  ]);

  useEffect(() => {
    if (!onConversationalBusyChange) return;
    if (!active || !externalConversationalComposer) {
      onConversationalBusyChange(false);
      return;
    }
    onConversationalBusyChange(convBusy);
  }, [
    active,
    convBusy,
    externalConversationalComposer,
    onConversationalBusyChange,
  ]);

  useEffect(() => {
    if (!active) {
      refinementOpeningInflightKeyRef.current = null;
      return;
    }
    if (
      !conversationalClip ||
      unifiedMode ||
      remoteLoading ||
      remoteError
    ) {
      return;
    }
    if (refinementOpeningInflightKeyRef.current === refinementPlanKey) {
      return;
    }
    refinementOpeningInflightKeyRef.current = refinementPlanKey;

    let cancelled = false;
    (async () => {
      setConvBusy(true);
      setConvErr(null);
      const openingUserLine = inputSummary.trim() || "Please refine this clip request.";
      setConvMsgs([{ id: newId(), role: "user", text: openingUserLine }]);
      try {
        const { msg, patches } = await callRefinementConversationApi([
          { role: "user", content: openingUserLine },
        ]);
        if (cancelled) return;
        setConvMsgs((prev) => [
          ...prev,
          { id: newId(), role: "assistant", text: msg },
        ]);
        if (patches && Object.keys(patches).length > 0) {
          setAnswers((prev) => ({ ...prev, ...patches }));
        }
      } catch (e) {
        if (!cancelled) {
          setConvErr(e instanceof Error ? e.message : "Something went wrong");
          setConvMsgs((prev) => [
            ...prev,
            {
              id: newId(),
              role: "assistant",
              text: CLIP_CONVERSATION_WELCOME,
            },
          ]);
        }
      } finally {
        if (!cancelled) setConvBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    active,
    conversationalClip,
    unifiedMode,
    remoteLoading,
    remoteError,
    refinementPlanKey,
    inputSummary,
    callRefinementConversationApi,
  ]);

  const handleConversationalSend = useCallback(async () => {
    const t = convInput.trim();
    if (!t) return;
    setConvInput("");
    await sendConversationalLine(t);
  }, [convInput, sendConversationalLine]);

  const clipAnswersReady = useMemo(
    () => refinementAnswersComplete(effectiveSteps, answers),
    [effectiveSteps, answers],
  );

  const refinementComposerTurn =
    unifiedMode && refinementActive && !clipAnswersReady;
  const panelComposerBusy = refinementComposerTurn ? convBusy : coachBusy;

  const handleUnifiedComposerSend = useCallback(async () => {
    const t = convInput.trim();
    if (!t || panelComposerBusy || !unifiedMode) return;
    if (refinementComposerTurn) {
      setConvInput("");
      await sendConversationalLine(t);
      return;
    }
    setConvInput("");
    const b = coachBriefRef.current;
    const wrapped =
      b.length > 0
        ? `[Clip workspace — not a transcript]\n${b}\n\n---\n\n${t}`
        : t;
    void sendCoachMessage({ text: wrapped });
  }, [
    convInput,
    panelComposerBusy,
    unifiedMode,
    refinementComposerTurn,
    sendConversationalLine,
    sendCoachMessage,
  ]);

  const handleAskAda = useCallback(async () => {
    if (!currentDef || !llmAssist) return;
    const userMessage =
      optionalDetailDraft.trim() ||
      `I need help deciding on: ${currentDef.message}`;
    setLlmBusy(true);
    setLlmError(null);
    setPendingLlmPatches(null);
    try {
      const allowedFieldKeys = effectiveSteps.map((s) => s.fieldKey);
      const res = await fetch("/api/refinement-thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          kind,
          platformIds,
          inputSummary,
          currentFieldKey: currentDef.fieldKey,
          currentQuestion: currentDef.message,
          answersPartial: answersRef.current,
          userMessage,
          guestCreditsRemaining: readGuestCreditsRemaining(),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        assistantMessage?: string;
        answerPatches?: Record<string, string>;
      };
      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }
      const msg = data.assistantMessage?.trim();
      if (!msg) throw new Error("Empty response");
      setThreadEntries((prev) => [
        ...prev,
        { id: newId(), role: "assistant", text: msg, source: "llm" },
      ]);
      if (data.answerPatches && Object.keys(data.answerPatches).length > 0) {
        const safe: Record<string, string> = {};
        for (const [k, v] of Object.entries(data.answerPatches)) {
          if (allowedFieldKeys.includes(k) && typeof v === "string" && v.trim()) {
            safe[k] = v.trim();
          }
        }
        if (Object.keys(safe).length > 0) setPendingLlmPatches(safe);
      }
    } catch (e) {
      setLlmError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLlmBusy(false);
    }
  }, [
    currentDef,
    llmAssist,
    kind,
    platformIds,
    inputSummary,
    effectiveSteps,
    optionalDetailDraft,
  ]);

  const applyPendingPatches = useCallback(() => {
    if (!pendingLlmPatches) return;
    setAnswers((prev) => ({ ...prev, ...pendingLlmPatches }));
    setPendingLlmPatches(null);
  }, [pendingLlmPatches]);

  const bubbleAssistant = kit
    ? "max-w-[95%] rounded-2xl rounded-bl-md border border-white/12 bg-white/[0.08] px-4 py-3 text-sm leading-relaxed text-white/95 backdrop-blur-sm"
    : "max-w-[95%] rounded-2xl rounded-bl-md bg-[#6C47FF]/10 px-4 py-3 text-sm leading-relaxed text-[#0F0A1E] dark:bg-violet-950/40 dark:text-zinc-100";

  const bubbleUser = kit
    ? "max-w-[95%] cursor-pointer rounded-2xl rounded-br-md border border-[#8800DC]/35 bg-[linear-gradient(95deg,#D31CD7_22%,#8800DC_100%)] px-4 py-3 text-left text-sm leading-relaxed text-white shadow-[0_8px_24px_rgba(136,1,220,0.18)] transition-opacity hover:opacity-95"
    : "max-w-[95%] cursor-pointer rounded-2xl rounded-br-md border border-violet-300/60 bg-violet-50 px-4 py-3 text-left text-sm leading-relaxed text-[#0F0A1E] dark:border-violet-500/40 dark:bg-violet-950/50 dark:text-zinc-100";

  const shell = embedInChat
    ? flatEmbedShell
      ? "flex min-h-0 flex-1 flex-col overflow-visible bg-transparent"
      : kit
        ? "flex flex-col overflow-hidden rounded-[20px_20px_20px_4px] border border-white/14 bg-white/[0.06] shadow-[0_12px_32px_rgba(0,0,0,0.28)] backdrop-blur-md outline outline-1 -outline-offset-1 outline-white/10"
        : "flex flex-col overflow-hidden rounded-2xl rounded-bl-md border border-ada-border bg-ada-card/95 shadow-md ring-1 ring-ada-border/40 backdrop-blur-sm"
    : kit
      ? "divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/14 bg-white/[0.06] backdrop-blur-sm outline outline-1 -outline-offset-1 outline-white/10"
      : "flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden rounded-xl border border-[#E8E4F8] bg-white dark:border-white/10 dark:bg-zinc-950";

  if (!active) return null;

  return (
    <div className={cn(shell, "min-h-0 flex-1 flex-col", className)}>
      {!hideChrome && (title ?? description) ? (
        <div
          className={cn(
            "shrink-0 border-b px-4 py-3 text-left",
            kit ? "border-white/10 bg-white/[0.04]" : "border-[#E8E4F8] bg-[#FAFAFC] dark:border-white/10 dark:bg-zinc-900/50",
          )}
        >
          {title ? (
            <h3
              className={cn(
                "text-base font-semibold",
                kit ? "text-white" : "text-[#0F0A1E] dark:text-white",
              )}
            >
              {title}
            </h3>
          ) : null}
          {description ? (
            <p
              className={cn(
                "mt-1 text-sm",
                kit ? "text-white/55" : "text-muted-foreground",
              )}
            >
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      {!hideChrome && !(title ?? description) ? (
        <div
          className={cn(
            "shrink-0 border-b px-4 py-2.5",
            kit ? "border-white/10 bg-white/[0.04]" : "border-border bg-muted/30",
          )}
        >
          <p
            className={cn(
              "text-xs font-medium",
              kit ? "text-white/70" : "text-muted-foreground",
            )}
          >
            {unifiedMode
              ? "Clip coach and job setup share this thread — chat credits apply per coach reply; setup uses the refinement conversation endpoint."
              : conversationalClip
                ? "Ada leads with a tailored first message from your workspace input. Reply below only when you want to adjust the plan (same credits as other Ada chats per message)."
                : kind === "video_variations"
                  ? "Quick questions so your five cuts match your goal."
                  : "Quick questions so your clip package matches your voice."}
          </p>
          {unifiedMode && !user ? (
            <p
              className={cn(
                "mt-1 text-[10px]",
                kit ? "text-amber-200/85" : "text-amber-700 dark:text-amber-300",
              )}
            >
              Signed out: coach replies use guest trial credits in this browser.
            </p>
          ) : null}
          {onCancel && (!unifiedMode || refinementActive) ? (
            <button
              type="button"
              onClick={onCancel}
              className={cn(
                "mt-1 text-[11px] underline-offset-2 hover:underline",
                kit ? "text-white/45 hover:text-white/70" : "text-muted-foreground",
              )}
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      {embedInChat && !flatEmbedShell ? (
        <div
          className={cn(
            "shrink-0 border-b px-4 py-2.5",
            kit ? "border-white/10 bg-black/15" : "border-ada-border bg-ada-sidebar/40",
          )}
        >
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums tracking-wide",
              kit ? "bg-white/10 text-white/80" : "bg-ada-elevated text-ada-secondary",
            )}
          >
            {remoteLoading
              ? "Preparing questions…"
              : conversationalClip
                ? unifiedMode
                  ? "Ada · clips & setup"
                  : "Ada · refine"
                : `Step ${Math.min(step + 1, totalSteps)} of ${totalSteps}`}
          </span>
        </div>
      ) : !embedInChat ? (
        <div
          className={cn(
            "text-muted-foreground shrink-0 border-b px-4 py-2 text-xs font-medium",
            kit ? "border-white/10 text-white/50" : "border-[#E8E4F8] dark:border-white/10",
          )}
        >
          {remoteLoading
            ? "Preparing questions…"
            : conversationalClip
              ? unifiedMode
                ? "Ada · clips & setup"
                : "Ada · refine"
              : `Step ${Math.min(step + 1, totalSteps)} of ${totalSteps}`}
        </div>
      ) : null}

      <div
        className={cn(
          "min-h-0 flex-1 py-3",
          inlineMainThreadMode ? "overflow-visible" : "overflow-y-auto",
          flatEmbedShell ? "px-0" : "px-4",
        )}
      >
        {flatEmbedShell && hideChrome && onCancel ? (
          <div className={cn("mb-2 flex justify-end", flatEmbedShell && "px-1")}>
            <button
              type="button"
              onClick={onCancel}
              className={cn(
                "text-[11px] underline-offset-2 hover:underline",
                kit ? "text-white/45 hover:text-white/70" : "text-muted-foreground",
              )}
            >
              Cancel refinement
            </button>
          </div>
        ) : null}
        {!embedInChat ? (
          <div
            className={cn(
              "mb-4 rounded-xl border px-3 py-2 text-xs",
              kit
                ? "border-white/12 bg-black/20 text-white/80"
                : "border-[#E8E4F8] bg-[#F0EFFE]/60 dark:border-white/10 dark:bg-zinc-900/40",
            )}
          >
            <span className={kit ? "text-white/45" : "text-muted-foreground"}>Input: </span>
            {inputSummary}
          </div>
        ) : null}

        {remoteLoading ? (
          <div className="space-y-3">
            <div className="flex justify-start">
              <div className={bubbleAssistant}>
                Reading your source and tailoring a few questions so the clip plan matches what
                you are actually trying to do.
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pl-0.5 opacity-50">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={cn(
                    "h-8 w-[88px] animate-pulse rounded-full",
                    kit ? "bg-white/10" : "bg-muted",
                  )}
                />
              ))}
            </div>
          </div>
        ) : remoteError ? (
          <div className="space-y-3">
            <div className="flex justify-start">
              <div className={bubbleAssistant}>
                Could not personalize questions ({remoteError.message}). You can retry, or
                cancel and try again.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={remoteError.onRetry}
                className={
                  kit
                    ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white hover:opacity-90"
                    : undefined
                }
              >
                Retry
              </Button>
              {onCancel ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onCancel}
                  className={
                    kit ? "border-white/20 bg-transparent text-white hover:bg-white/10" : undefined
                  }
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        ) : conversationalClip ? (
          unifiedMode ? (
            <div className="flex min-h-[min(28vh,220px)] max-h-[min(50vh,560px)] flex-col gap-2 sm:max-h-[min(48vh,520px)]">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {coachMsgs.length === 0 ? (
                  <p className="text-sm text-white/45">
                    Ask for clip angles, hook rewrites, or pacing. When you send from the
                    composer below with a valid source, guided setup appears in this same
                    thread.
                  </p>
                ) : (
                  coachMsgs.map((m) => {
                    const body = coachTextFromParts(m);
                    return (
                      <div
                        key={m.id}
                        className={
                          m.role === "user" ? "flex justify-end" : "flex justify-start"
                        }
                      >
                        <div
                          className={cn(
                            "max-w-[95%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                            m.role === "user"
                              ? kit
                                ? "rounded-br-md border border-[#8800DC]/35 bg-[linear-gradient(95deg,#D31CD7_22%,#8800DC_100%)] text-white shadow-[0_8px_24px_rgba(136,1,220,0.18)]"
                                : "rounded-br-md border border-violet-300/60 bg-violet-50 text-[#0F0A1E] dark:border-violet-500/40 dark:bg-violet-950/50 dark:text-zinc-100"
                              : bubbleAssistant,
                          )}
                        >
                          <p className="whitespace-pre-wrap text-[13px] leading-snug">{body}</p>
                          {m.role === "assistant" && body.trim() && onApplyCoachToPrompt ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="mt-2 h-7 px-2 text-[11px] text-[#e8b4ff] hover:bg-white/10 hover:text-white"
                              onClick={() => onApplyCoachToPrompt(body)}
                            >
                              Add to clip prompt
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
                {refinementActive ? (
                  <>
                    <div
                      className={cn(
                        "mt-3 border-t pt-3",
                        kit ? "border-white/10" : "border-border dark:border-white/10",
                      )}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/50">
                        Clip job setup
                      </p>
                    </div>
                    {convMsgs.map((m) =>
                      m.role === "assistant" ? (
                        <div key={m.id} className="flex justify-start">
                          <div className={bubbleAssistant}>
                            <p className="whitespace-pre-wrap">{m.text}</p>
                          </div>
                        </div>
                      ) : (
                        <div key={m.id} className="flex justify-end">
                          <div
                            className={cn(
                              "max-w-[95%] rounded-2xl rounded-br-md border px-4 py-3 text-left text-sm leading-relaxed",
                              kit
                                ? "border-[#8800DC]/35 bg-[linear-gradient(95deg,#D31CD7_22%,#8800DC_100%)] text-white shadow-[0_8px_24px_rgba(136,1,220,0.18)]"
                                : "border border-violet-300/60 bg-violet-50 text-[#0F0A1E] dark:border-violet-500/40 dark:bg-violet-950/50 dark:text-zinc-100",
                            )}
                          >
                            <p className="whitespace-pre-wrap text-left">{m.text}</p>
                          </div>
                        </div>
                      ),
                    )}
                    {convBusy ? (
                      <div className="flex justify-start text-xs text-white/50">Ada is typing…</div>
                    ) : null}
                    {convErr ? (
                      <p className="text-xs text-red-300" role="alert">
                        {convErr}
                      </p>
                    ) : null}
                    {clipAnswersReady ? (
                      <div className="space-y-3 border-t border-white/10 pt-3 dark:border-white/10">
                        <p className="text-xs text-white/60">
                          All clip settings are filled. Optionally add a niche, then start
                          the job — or keep chatting to adjust.
                        </p>
                        <div className="space-y-2">
                          <Label
                            htmlFor="refine-niche-conv-unified"
                            className={kit ? "text-white/70" : undefined}
                          >
                            Niche or account theme (optional)
                          </Label>
                          <input
                            id="refine-niche-conv-unified"
                            className={cn(
                              "h-10 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-[3px]",
                              kit
                                ? "border-white/14 bg-black/25 text-white ring-violet-500/30 placeholder:text-white/35"
                                : "border-[#E8E4F8] bg-white ring-[#6C47FF]/25 dark:border-white/10 dark:bg-zinc-950",
                            )}
                            value={summaryNiche}
                            onChange={(e) => setSummaryNiche(e.target.value)}
                            placeholder="e.g. Islamic content, B2B SaaS, comedy…"
                          />
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button
                            type="button"
                            className={cn(
                              "flex-1",
                              kit &&
                                "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white hover:opacity-90",
                            )}
                            onClick={handleConfirmGenerate}
                          >
                            Looks good — start job
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className={cn(
                              "flex-1",
                              kit &&
                                "border-white/20 bg-transparent text-white hover:bg-white/10",
                            )}
                            onClick={goBackToQuestions}
                          >
                            Start over
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {coachBusy && !refinementComposerTurn ? (
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    Thinking…
                  </div>
                ) : null}
                <div ref={convEndRef} className="h-1 shrink-0" aria-hidden />
              </div>
              <div className="shrink-0 space-y-2 border-t border-white/10 pt-2 dark:border-white/10">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  <textarea
                    rows={2}
                    className={cn(
                      "min-h-[44px] flex-1 resize-none rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]",
                      kit
                        ? "border-white/14 bg-black/25 text-white ring-violet-500/30 placeholder:text-white/35"
                        : "border-[#E8E4F8] bg-white ring-[#6C47FF]/25 dark:border-white/10 dark:bg-zinc-950",
                    )}
                    value={convInput}
                    onChange={(e) => setConvInput(e.target.value)}
                    placeholder={
                      refinementComposerTurn
                        ? "Message Ada about clip settings…"
                        : "Ask for hooks, timestamps, scripts…"
                    }
                    disabled={panelComposerBusy}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleUnifiedComposerSend();
                      }
                    }}
                  />
                  {coachBusy && !refinementComposerTurn ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className={cn(
                        "shrink-0 self-end",
                        kit ? "border-white/20 bg-white/10 text-white hover:bg-white/15" : undefined,
                      )}
                      onClick={() => void stopCoach()}
                    >
                      Stop
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      className={cn(
                        "shrink-0 self-end",
                        kit &&
                          "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white hover:opacity-90",
                      )}
                      disabled={!convInput.trim() || panelComposerBusy}
                      onClick={() => void handleUnifiedComposerSend()}
                    >
                      {panelComposerBusy ? "Sending…" : "Send"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : (
          <div
            className={
              inlineMainThreadMode
                ? "flex min-h-0 flex-col gap-2"
                : cn(
                    "flex max-h-[min(62vh,580px)] flex-col gap-2",
                    externalConversationalComposer || flatEmbedShell
                      ? "min-h-0"
                      : "min-h-[min(36vh,300px)]",
                  )
            }
          >
            <div
              className={
                inlineMainThreadMode
                  ? "space-y-3"
                  : "min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
              }
            >
              {convMsgs.map((m) =>
                m.role === "assistant" ? (
                  <div key={m.id} className="flex justify-start">
                    <div className={bubbleAssistant}>
                      <p className="whitespace-pre-wrap">{m.text}</p>
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex justify-end">
                    <div
                      className={cn(
                        "max-w-[95%] rounded-2xl rounded-br-md border px-4 py-3 text-left text-sm leading-relaxed",
                        kit
                          ? "border-[#8800DC]/35 bg-[linear-gradient(95deg,#D31CD7_22%,#8800DC_100%)] text-white shadow-[0_8px_24px_rgba(136,1,220,0.18)]"
                          : "border border-violet-300/60 bg-violet-50 text-[#0F0A1E] dark:border-violet-500/40 dark:bg-violet-950/50 dark:text-zinc-100",
                      )}
                    >
                      <p className="whitespace-pre-wrap text-left">{m.text}</p>
                    </div>
                  </div>
                ),
              )}
              {convBusy ? (
                <div className="flex justify-start text-xs text-white/50">
                  Ada is typing…
                </div>
              ) : null}
              {convErr ? (
                <p className="text-xs text-red-300" role="alert">
                  {convErr}
                </p>
              ) : null}
              {clipAnswersReady ? (
                <div className="space-y-3 border-t border-white/10 pt-3 dark:border-white/10">
                  <p className="text-xs text-white/60">
                    All clip settings are filled. Optionally add a niche, then start
                    the job — or keep chatting to adjust.
                  </p>
                  <div className="space-y-2">
                    <Label
                      htmlFor="refine-niche-conv"
                      className={kit ? "text-white/70" : undefined}
                    >
                      Niche or account theme (optional)
                    </Label>
                    <input
                      id="refine-niche-conv"
                      className={cn(
                        "h-10 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-[3px]",
                        kit
                          ? "border-white/14 bg-black/25 text-white ring-violet-500/30 placeholder:text-white/35"
                          : "border-[#E8E4F8] bg-white ring-[#6C47FF]/25 dark:border-white/10 dark:bg-zinc-950",
                      )}
                      value={summaryNiche}
                      onChange={(e) => setSummaryNiche(e.target.value)}
                      placeholder="e.g. Islamic content, B2B SaaS, comedy…"
                    />
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      className={cn(
                        "flex-1",
                        kit &&
                          "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white hover:opacity-90",
                      )}
                      onClick={handleConfirmGenerate}
                    >
                      Looks good — start job
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "flex-1",
                        kit &&
                          "border-white/20 bg-transparent text-white hover:bg-white/10",
                      )}
                      onClick={goBackToQuestions}
                    >
                      Start over
                    </Button>
                  </div>
                </div>
              ) : null}
              <div ref={convEndRef} className="h-1 shrink-0" aria-hidden />
            </div>
            {!externalConversationalComposer ? (
              <div className="shrink-0 space-y-2 border-t border-white/10 pt-2 dark:border-white/10">
                <textarea
                  rows={2}
                  className={cn(
                    "w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]",
                    kit
                      ? "border-white/14 bg-black/25 text-white ring-violet-500/30 placeholder:text-white/35"
                      : "border-[#E8E4F8] bg-white ring-[#6C47FF]/25 dark:border-white/10 dark:bg-zinc-950",
                  )}
                  value={convInput}
                  onChange={(e) => setConvInput(e.target.value)}
                  placeholder="Message Ada…"
                  disabled={convBusy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleConversationalSend();
                    }
                  }}
                />
                <Button
                  type="button"
                  className={cn(
                    "w-full sm:w-auto",
                    kit &&
                      "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white hover:opacity-90",
                  )}
                  disabled={!convInput.trim() || convBusy}
                  onClick={() => void handleConversationalSend()}
                >
                  {convBusy ? "Sending…" : "Send"}
                </Button>
              </div>
            ) : null}
          </div>
          )
        ) : (
          <div className="space-y-4">
            {threadEntries.map((entry) =>
              entry.role === "assistant" ? (
                <div key={entry.id} className="flex justify-start">
                  <div
                    className={cn(
                      bubbleAssistant,
                      entry.source === "llm" &&
                        kit &&
                        "border-violet-400/30 bg-violet-950/35",
                    )}
                  >
                    {entry.source === "llm" ? (
                      <p
                        className={cn(
                          "mb-2 text-[10px] font-semibold uppercase tracking-wide",
                          kit ? "text-violet-200/90" : "text-violet-700 dark:text-violet-300",
                        )}
                      >
                        Ada (clarify)
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap">{entry.text}</p>
                  </div>
                </div>
              ) : (
                <div key={entry.id} className="flex justify-end">
                  <button
                    type="button"
                    className={bubbleUser}
                    onClick={() => restartFromField(entry.fieldKey)}
                    title="Tap to edit from this answer"
                  >
                    <p className="text-[10px] font-medium opacity-90">
                      {entry.displayLabel}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-left opacity-95">
                      {entry.storedValue}
                    </p>
                    <p
                      className={cn(
                        "mt-2 text-[10px] underline-offset-2",
                        kit ? "text-white/70" : "text-muted-foreground",
                      )}
                    >
                      Tap to change this answer
                    </p>
                  </button>
                </div>
              ),
            )}

            {!isSummary && currentDef ? (
              <div className="space-y-3 border-t border-white/10 pt-3 dark:border-white/10">
                <div className="space-y-2">
                  <Label
                    htmlFor="refine-optional-detail"
                    className={kit ? "text-white/65" : undefined}
                  >
                    Optional detail (merged into your next choice)
                  </Label>
                  <textarea
                    id="refine-optional-detail"
                    rows={2}
                    className={cn(
                      "w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]",
                      kit
                        ? "border-white/14 bg-black/25 text-white ring-violet-500/30 placeholder:text-white/35"
                        : "border-[#E8E4F8] bg-white ring-[#6C47FF]/25 dark:border-white/10 dark:bg-zinc-950",
                    )}
                    value={optionalDetailDraft}
                    onChange={(e) => setOptionalDetailDraft(e.target.value)}
                    placeholder="e.g. audience is beginners, brand is playful…"
                  />
                  {llmAssist ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={llmBusy}
                        className={
                          kit
                            ? "border-white/25 bg-transparent text-white hover:bg-white/10"
                            : undefined
                        }
                        onClick={() => void handleAskAda()}
                      >
                        {llmBusy ? "Asking Ada…" : "Ask Ada to clarify"}
                      </Button>
                      {llmError ? (
                        <p className="text-xs text-red-300" role="alert">
                          {llmError}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>

                {primaryOpenAnswer ? (
                  <div className="space-y-2 pl-0.5">
                    <Label
                      htmlFor="refine-custom-inline"
                      className={kit ? "text-white/70" : undefined}
                    >
                      Your answer
                    </Label>
                    <textarea
                      ref={openAnswerTextareaRef}
                      id="refine-custom-inline"
                      autoFocus
                      className={cn(
                        "min-h-[88px] w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]",
                        kit
                          ? "border-white/14 bg-black/25 text-white ring-violet-500/30 placeholder:text-white/35"
                          : "border-[#E8E4F8] bg-white text-[#0F0A1E] ring-[#6C47FF]/25 dark:border-white/10 dark:bg-zinc-950",
                      )}
                      value={customDraft}
                      onChange={(e) => setCustomDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleCustomSubmit();
                        }
                      }}
                      placeholder="Type your answer…"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleCustomSubmit}
                        disabled={!customDraft.trim()}
                        className={
                          kit
                            ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white hover:opacity-90"
                            : undefined
                        }
                      >
                        Continue
                      </Button>
                    </div>
                  </div>
                ) : customMode && currentDef.allowCustom ? (
                  <div className="space-y-2 pl-0.5">
                    <Label
                      htmlFor="refine-custom-inline"
                      className={kit ? "text-white/70" : undefined}
                    >
                      Your answer
                    </Label>
                    <textarea
                      id="refine-custom-inline"
                      className={cn(
                        "min-h-[88px] w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]",
                        kit
                          ? "border-white/14 bg-black/25 text-white ring-violet-500/30 placeholder:text-white/35"
                          : "border-[#E8E4F8] bg-white text-[#0F0A1E] ring-[#6C47FF]/25 dark:border-white/10 dark:bg-zinc-950",
                      )}
                      value={customDraft}
                      onChange={(e) => setCustomDraft(e.target.value)}
                      placeholder="Type your answer…"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          setCustomMode(false);
                          setCustomDraft("");
                        }}
                        variant="outline"
                        className={kit ? "border-white/20 bg-transparent text-white hover:bg-white/10" : undefined}
                      >
                        Back to choices
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleCustomSubmit}
                        disabled={!customDraft.trim()}
                        className={
                          kit
                            ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white hover:opacity-90"
                            : undefined
                        }
                      >
                        Continue
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 pl-0.5">
                    {currentDef.pills.map((p) => (
                      <Button
                        key={p.label}
                        type="button"
                        size="sm"
                        variant="secondary"
                        className={cn(
                          "rounded-full transition-colors duration-150 active:scale-[0.98]",
                          kit &&
                            "border border-white/18 bg-white/10 text-white hover:bg-white/16 hover:border-white/28",
                        )}
                        onClick={() =>
                          handlePill(currentDef.fieldKey, p.value, p.label)
                        }
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ) : !remoteLoading && !remoteError ? (
              <div className="space-y-3 border-t border-white/10 pt-3 dark:border-white/10">
                {pendingLlmPatches ? (
                  <div
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm",
                      kit
                        ? "border-violet-400/30 bg-violet-950/30 text-white/90"
                        : "border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/40",
                    )}
                  >
                    <p className="mb-2 text-xs font-medium">
                      Ada suggested field updates (optional)
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={applyPendingPatches}
                      className={
                        kit
                          ? "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white hover:opacity-90"
                          : undefined
                      }
                    >
                      Merge suggestions into answers
                    </Button>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="refine-niche-inline" className={kit ? "text-white/70" : undefined}>
                    Niche or account theme (optional)
                  </Label>
                  <input
                    id="refine-niche-inline"
                    className={cn(
                      "h-10 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-[3px]",
                      kit
                        ? "border-white/14 bg-black/25 text-white ring-violet-500/30 placeholder:text-white/35"
                        : "border-[#E8E4F8] bg-white ring-[#6C47FF]/25 dark:border-white/10 dark:bg-zinc-950",
                    )}
                    value={summaryNiche}
                    onChange={(e) => setSummaryNiche(e.target.value)}
                    placeholder="e.g. Islamic content, B2B SaaS, comedy…"
                  />
                </div>

                <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                  <Button
                    type="button"
                    className={cn(
                      "flex-1",
                      kit &&
                        "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] text-white hover:opacity-90",
                    )}
                    onClick={handleConfirmGenerate}
                  >
                    {kind === "video_variations" ? "Looks good — start job" : "Looks good, generate"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "flex-1",
                      kit && "border-white/20 bg-transparent text-white hover:bg-white/10",
                    )}
                    onClick={goBackToQuestions}
                  >
                    Edit answers
                  </Button>
                </div>
              </div>
            ) : null}

            <div ref={threadEndRef} className="h-1 shrink-0" aria-hidden />
          </div>
        )}
      </div>
    </div>
  );
}
