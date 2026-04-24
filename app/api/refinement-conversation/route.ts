import { openai } from "@ai-sdk/openai";
import {
  APICallError,
  generateText,
  generateObject,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
} from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isUnlimitedCreditsModeServer } from "@/lib/credits-config";
import {
  remainingCreditsForDisplay,
  type ProfileCreditsRow,
} from "@/lib/profile-credits-display";
import {
  buildRefinementConversationSystemPrompt,
  refinementAnswersComplete,
} from "@/lib/refinement-conversation-prompt";
import { isPlatformId, type PlatformId } from "@/lib/platforms";
import {
  buildRefinementSteps,
  type RefinementKind,
} from "@/lib/refinement-steps";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/** Rough cap so transcript + summary stay under provider context limits. */
const MAX_REFINEMENT_CONV_PROMPT_CHARS = 95_000;

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(12_000),
});

const bodySchema = z.object({
  kind: z.enum(["video_variations", "text_generation"]),
  platformIds: z.array(z.string()).min(1).max(12),
  inputSummary: z.string().max(4000),
  messages: z.array(messageSchema).min(1).max(48),
  answersPartial: z.record(z.string(), z.string()).default({}),
  guestCreditsRemaining: z.number().int().optional(),
  /** Client-generated id; transcript is upserted after a successful model turn (signed-in only). */
  sessionId: z.string().uuid().optional(),
});

const resultSchema = z.object({
  assistantMessage: z.string().min(1).max(3200),
  answerPatches: z.record(z.string(), z.string()).optional(),
});

type RefinementConversationResult = z.infer<typeof resultSchema>;

type ProfileCreditsRowRefine = ProfileCreditsRow & {
  generation_count: number | null;
};

async function refundOneClipCredit(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  await supabase.rpc("refund_one_credit", { p_user_id: userId });
}

function normalizePlatforms(raw: string[]): PlatformId[] {
  const out: PlatformId[] = [];
  const seen = new Set<PlatformId>();
  for (const r of raw) {
    if (!isPlatformId(r) || seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

function platformLine(ids: PlatformId[]): string {
  return ids.join(", ");
}

const AGENT_DEBUG_SESSION = "b060d4";
const AGENT_DEBUG_INGEST =
  "http://127.0.0.1:7399/ingest/e33120b8-b88c-43a8-8cb8-ba98dc672bfb";

function serializeErrorForDebug(e: unknown): Record<string, unknown> {
  const ctor =
    e != null && typeof e === "object"
      ? (e as { constructor?: { name?: string } }).constructor?.name
      : typeof e;
  const out: Record<string, unknown> = {
    ctor: ctor ?? "unknown",
    message: e instanceof Error ? e.message : String(e),
  };
  if (APICallError.isInstance(e)) {
    out.statusCode = e.statusCode;
    out.urlTail =
      typeof e.url === "string" ? e.url.slice(-80) : undefined;
    out.responseBodyPreview =
      typeof e.responseBody === "string"
        ? e.responseBody.slice(0, 500)
        : undefined;
  }
  if (e instanceof Error && e.cause != null) {
    out.causeMessage =
      e.cause instanceof Error ? e.cause.message : String(e.cause);
  }
  return out;
}

/** NDJSON debug (local ingest + stderr for Vercel / prod). */
function agentDebugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  const payload = {
    sessionId: AGENT_DEBUG_SESSION,
    runId:
      typeof process.env.VERCEL_DEPLOYMENT_ID === "string"
        ? process.env.VERCEL_DEPLOYMENT_ID
        : "local",
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };
  // #region agent log
  try {
    console.error("[agent-debug]", JSON.stringify(payload));
  } catch {
    /* ignore */
  }
  void fetch(AGENT_DEBUG_INGEST, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": AGENT_DEBUG_SESSION,
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
  // #endregion
}

function refinementFailureCode(error: unknown): string {
  if (NoObjectGeneratedError.isInstance(error)) return "REFINEMENT_NO_OBJECT";
  if (NoOutputGeneratedError.isInstance(error)) return "REFINEMENT_NO_OUTPUT";
  if (APICallError.isInstance(error)) return "REFINEMENT_OPENAI_HTTP";
  return "REFINEMENT_UNKNOWN";
}

/** User-safe copy for `generateObject` / network failures (no stack traces). */
function refinementConversationFailureMessage(error: unknown): string {
  if (NoObjectGeneratedError.isInstance(error)) {
    if (error.finishReason === "length") {
      return "Ada's reply hit length limits before settings could be saved. No credits were charged. Try a shorter thread or message.";
    }
    return "Ada could not return structured clip settings. No credits were charged. Try again or shorten your message.";
  }
  if (NoOutputGeneratedError.isInstance(error)) {
    return "The model returned no output. No credits were charged. Please try again.";
  }
  if (APICallError.isInstance(error)) {
    const sc = error.statusCode;
    const body =
      typeof error.responseBody === "string"
        ? error.responseBody.toLowerCase()
        : "";
    if (
      body.includes("invalid_api_key") ||
      body.includes("incorrect api key")
    ) {
      return "OpenAI rejected the API key. No credits were charged. Check OPENAI_API_KEY on the server.";
    }
    if (
      body.includes("insufficient_quota") ||
      body.includes("billing_hard_limit")
    ) {
      return "OpenAI account is out of quota or billing is blocked. No credits were charged.";
    }
    if (body.includes("model") && (body.includes("not found") || body.includes("does not exist"))) {
      return "The configured refinement model is not available for this API key. No credits were charged. Check OPENAI_REFINEMENT_CONVERSATION_MODEL.";
    }
    if (sc === 401 || sc === 403) {
      return "OpenAI rejected the request (invalid API key or access). No credits were charged. If this keeps happening, check OPENAI_API_KEY on the server.";
    }
    if (sc === 429) {
      return "The model provider rate-limited this request. No credits were charged. Try again in a moment.";
    }
    if (sc != null && sc >= 500) {
      return "The model provider had a temporary error. No credits were charged. Please try again.";
    }
    if (sc === 400) {
      return "OpenAI rejected the request (bad parameters or payload). No credits were charged. If this persists, check server logs.";
    }
  }
  const msg = error instanceof Error ? error.message : String(error);
  const m = msg.toLowerCase();
  if (
    m.includes("no object generated") ||
    m.includes("did not return a response") ||
    m.includes("could not parse") ||
    m.includes("failed to parse") ||
    m.includes("json parse") ||
    m.includes("type validation") ||
    m.includes("schema")
  ) {
    return "Ada could not produce a structured reply. No credits were charged. Try again or shorten your message.";
  }
  if (m.includes("rate limit") || m.includes("429") || m.includes("too many requests")) {
    return "The model is temporarily busy. No credits were charged. Please try again in a moment.";
  }
  if (
    m.includes("context length") ||
    m.includes("maximum context") ||
    m.includes("token") ||
    m.includes("too long")
  ) {
    return "That input is too long for the model right now. No credits were charged. Try a shorter message.";
  }
  if (m.includes("fetch failed") || m.includes("econnreset") || m.includes("socket")) {
    return "Could not reach the model provider. No credits were charged. Check your connection and try again.";
  }
  return "Generation failed. No credits were charged.";
}

function extractBalancedJsonObject(text: string): string | null {
  let start = text.indexOf("{");
  while (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "\"") {
          inString = false;
        }
        continue;
      }
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{") {
        depth += 1;
        continue;
      }
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
    start = text.indexOf("{", start + 1);
  }
  return null;
}

function parseRefinementResultFromText(
  text: string | undefined,
): RefinementConversationResult | null {
  if (!text || !text.trim()) return null;
  const trimmed = text.trim();
  const candidates = new Set<string>([trimmed]);
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    candidates.add(fencedMatch[1].trim());
  }
  const balanced = extractBalancedJsonObject(trimmed);
  if (balanced) {
    candidates.add(balanced);
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const coerced = resultSchema.safeParse(parsed);
      if (coerced.success) return coerced.data;
    } catch {
      // Keep trying other extraction candidates.
    }
  }
  return null;
}

async function recoverStructuredRefinementResult(params: {
  modelId: string;
  system: string;
  promptForModel: string;
  error: unknown;
}): Promise<RefinementConversationResult | null> {
  if (NoObjectGeneratedError.isInstance(params.error)) {
    const fromErrorText = parseRefinementResultFromText(params.error.text);
    if (fromErrorText) {
      agentDebugLog(
        "H5",
        "route.ts:recover-error-text",
        "recovered structured output from NoObjectGeneratedError.text",
        { textPreview: (params.error.text ?? "").slice(0, 220) },
      );
      return fromErrorText;
    }
  }

  const fallbackSystem = `${params.system}

Critical output format:
- Return ONLY one JSON object. No markdown, no prose, no code fences.
- JSON schema: {"assistantMessage": string, "answerPatches"?: Record<string,string>}
- assistantMessage must be non-empty and under 3200 chars.
- answerPatches may be omitted if nothing new is confidently captured.`;

  try {
    const { text } = await generateText({
      model: openai(params.modelId),
      temperature: 0.25,
      maxOutputTokens: 1600,
      maxRetries: 1,
      system: fallbackSystem,
      prompt: params.promptForModel,
      providerOptions: {
        openai: {
          strictJsonSchema: false,
        },
      },
    });
    const recovered = parseRefinementResultFromText(text);
    if (recovered) {
      agentDebugLog("H6", "route.ts:recover-generateText", "fallback JSON recovered", {
        textPreview: text.slice(0, 220),
      });
      return recovered;
    }
    agentDebugLog("H7", "route.ts:recover-generateText-failed-parse", "fallback JSON parse failed", {
      textPreview: text.slice(0, 220),
    });
  } catch (fallbackErr) {
    agentDebugLog(
      "H8",
      "route.ts:recover-generateText-throw",
      "fallback generateText threw",
      serializeErrorForDebug(fallbackErr),
    );
  }
  return null;
}

/** Best-effort DB write; must never fail the HTTP response after a good model turn. */
function persistClipRefinementSessionFireAndForget(
  supabase: SupabaseClient,
  params: {
    sessionId: string;
    userId: string;
    kind: "video_variations" | "text_generation";
    inputSummary: string;
    messages: { role: "user" | "assistant"; content: string }[];
    answersPartial: Record<string, string>;
  },
): void {
  void (async () => {
    try {
      const messagesJson: unknown = JSON.parse(JSON.stringify(params.messages));
      const answersJson: unknown = JSON.parse(
        JSON.stringify(params.answersPartial),
      );
      const { error: persistErr } = await supabase
        .from("clip_refinement_sessions")
        .upsert(
          {
            id: params.sessionId,
            user_id: params.userId,
            refinement_kind: params.kind,
            input_summary: params.inputSummary.slice(0, 4000),
            messages: messagesJson,
            answers_partial: answersJson,
          },
          { onConflict: "id" },
        );
      if (persistErr) {
        console.error(
          "[refinement-conversation] clip_refinement_sessions upsert failed",
          persistErr.message,
          persistErr.code,
          persistErr.details,
        );
      }
    } catch (e) {
      console.error(
        "[refinement-conversation] clip_refinement_sessions persist exception",
        e,
      );
    }
  })();
}

export async function POST(req: Request): Promise<Response> {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      {
        error:
          "Missing OPENAI_API_KEY in environment. No credits were charged.",
        code: "MISSING_OPENAI",
      },
      { status: 500 },
    );
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch (e) {
    console.error("[refinement-conversation] createClient failed", e);
    return Response.json(
      {
        error:
          "Server misconfiguration: could not create Supabase client. No credits were charged.",
        code: "SUPABASE_CONFIG",
      },
      { status: 500 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body. No credits were charged." },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join(" ");
    return Response.json(
      { error: `${msg} No credits were charged.` },
      { status: 400 },
    );
  }

  const {
    kind,
    platformIds: rawPlatforms,
    inputSummary,
    messages,
    answersPartial,
    guestCreditsRemaining,
    sessionId,
  } = parsed.data;

  const platformIds = normalizePlatforms(rawPlatforms);
  if (platformIds.length === 0) {
    return Response.json(
      { error: "At least one valid platform id is required." },
      { status: 400 },
    );
  }

  const unlimitedServer = isUnlimitedCreditsModeServer();
  if (!user) {
    if (!unlimitedServer) {
      const guestOk =
        typeof guestCreditsRemaining === "number" &&
        guestCreditsRemaining >= 1;
      if (!guestOk) {
        return Response.json(
          {
            error:
              "No guest trial credits left in this browser, or counts are out of sync. Sign in to continue, or refresh the page. No credits were charged.",
          },
          { status: 401 },
        );
      }
    }
  }

  const steps = buildRefinementSteps(kind as RefinementKind, platformIds);
  const allowedFieldKeys = new Set(steps.map((s) => s.fieldKey));

  const userIdForBilling: string | null = user?.id ?? null;
  let chargedCredit = false;

  if (userIdForBilling) {
    const uid = userIdForBilling;
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select(
        "credits, unlimited_credits, generation_count, subscription_status, plan_credits_remaining, bonus_credits",
      )
      .eq("id", uid)
      .maybeSingle();

    if (profErr) {
      console.error(
        "[refinement-conversation] profile read failed",
        profErr.message,
      );
      return Response.json(
        { error: "Failed to load your profile. No credits were charged." },
        { status: 500 },
      );
    }

    const row = prof as ProfileCreditsRowRefine | null;
    const hadUnlimitedProfile = Boolean(row?.unlimited_credits);

    if (!unlimitedServer && !hadUnlimitedProfile) {
      const remaining = remainingCreditsForDisplay(row);
      if (remaining <= 0) {
        return Response.json(
          { error: "No credits remaining." },
          { status: 402 },
        );
      }

      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        "consume_one_credit",
        { p_user_id: uid },
      );

      if (rpcErr) {
        console.error(
          "[refinement-conversation] consume_one_credit failed",
          rpcErr.message,
        );
        return Response.json(
          { error: "Failed to reserve credit. No credits were charged." },
          { status: 500 },
        );
      }

      const rpcRow = (
        Array.isArray(rpcData) ? rpcData[0] : rpcData
      ) as { success?: boolean; reason?: string | null } | undefined;

      if (!rpcRow || rpcRow.success !== true) {
        const reason = rpcRow?.reason ?? "unknown";
        if (reason === "no_credits" || /no_credit/i.test(String(reason))) {
          return Response.json(
            { error: "No credits remaining." },
            { status: 402 },
          );
        }
        return Response.json(
          { error: "Failed to reserve credit. No credits were charged." },
          { status: 500 },
        );
      }

      chargedCredit = true;
    }
  }

  const modelId =
    process.env.OPENAI_REFINEMENT_CONVERSATION_MODEL?.trim() ||
    process.env.OPENAI_REFINEMENT_THREAD_MODEL?.trim() ||
    "gpt-4o-mini";

  const system = buildRefinementConversationSystemPrompt(
    steps,
    platformLine(platformIds),
  );

  const transcript = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const prompt = `Source / input summary:\n${inputSummary.slice(0, 4000)}\n\nCurrent captured answers (JSON, may be empty):\n${JSON.stringify(answersPartial)}\n\nConversation:\n${transcript}`;

  let promptForModel = prompt;
  if (promptForModel.length > MAX_REFINEMENT_CONV_PROMPT_CHARS) {
    const tail = "\n\n[Truncated for model context limits.]";
    promptForModel =
      promptForModel.slice(
        0,
        MAX_REFINEMENT_CONV_PROMPT_CHARS - tail.length,
      ) + tail;
    agentDebugLog("H3", "route.ts:truncate", "prompt truncated", {
      originalChars: prompt.length,
      truncatedChars: promptForModel.length,
    });
  }

  agentDebugLog("H0", "route.ts:pre-generateObject", "about to call model", {
    kind,
    platformCount: platformIds.length,
    messageCount: messages.length,
    promptChars: promptForModel.length,
    systemChars: system.length,
    modelId,
    chargedCredit,
  });

  let structuredResult: RefinementConversationResult | null = null;

  try {
    const { object } = await generateObject({
      model: openai(modelId),
      schema: resultSchema,
      temperature: 0.45,
      maxOutputTokens: 1600,
      maxRetries: 2,
      system,
      prompt: promptForModel,
      providerOptions: {
        openai: {
          strictJsonSchema: false,
        },
      },
    });

    agentDebugLog("H4", "route.ts:post-generateObject", "generateObject resolved", {
      hasObject: object != null,
      objectKeys:
        object != null && typeof object === "object"
          ? Object.keys(object as Record<string, unknown>).slice(0, 12)
          : [],
    });

    const coerced = resultSchema.safeParse(object);
    if (coerced.success) {
      structuredResult = coerced.data;
    } else {
      agentDebugLog("H2", "route.ts:coerce-fail", "resultSchema.safeParse failed", {
        zodIssueMessages: coerced.error.issues
          .slice(0, 10)
          .map((i) => i.message),
      });
      structuredResult = await recoverStructuredRefinementResult({
        modelId,
        system,
        promptForModel,
        error: coerced.error,
      });
    }
  } catch (e) {
    console.error("[refinement-conversation] generateObject failed", e);
    agentDebugLog(
      "H1",
      "route.ts:catch",
      "generateObject try block threw",
      serializeErrorForDebug(e),
    );
    structuredResult = await recoverStructuredRefinementResult({
      modelId,
      system,
      promptForModel,
      error: e,
    });
    if (!structuredResult) {
      if (chargedCredit && userIdForBilling) {
        try {
          await refundOneClipCredit(supabase, userIdForBilling);
        } catch (refundErr) {
          console.error("[refinement-conversation] refund failed", refundErr);
        }
      }
      return Response.json(
        {
          error: refinementConversationFailureMessage(e),
          code: refinementFailureCode(e),
        },
        { status: 500 },
      );
    }
  }

  if (!structuredResult) {
    if (chargedCredit && userIdForBilling) {
      try {
        await refundOneClipCredit(supabase, userIdForBilling);
      } catch (e) {
        console.error("[refinement-conversation] refund after schema fail", e);
      }
    }
    return Response.json(
      { error: "Invalid model output. No credits were charged." },
      { status: 500 },
    );
  }

  const filteredPatches: Record<string, string> = {};
  if (structuredResult.answerPatches) {
    for (const [k, v] of Object.entries(structuredResult.answerPatches)) {
      if (!allowedFieldKeys.has(k)) continue;
      if (typeof v !== "string" || !v.trim()) continue;
      filteredPatches[k] = v.trim().slice(0, 2000);
    }
  }

  const merged: Record<string, string> = {
    ...answersPartial,
    ...filteredPatches,
  };
  const readyForConfirm = refinementAnswersComplete(steps, merged);

  if (user?.id && sessionId) {
    persistClipRefinementSessionFireAndForget(supabase, {
      sessionId,
      userId: user.id,
      kind,
      inputSummary,
      messages,
      answersPartial: merged,
    });
  }

  return Response.json({
    assistantMessage: structuredResult.assistantMessage.trim(),
    answerPatches:
      Object.keys(filteredPatches).length > 0 ? filteredPatches : undefined,
    readyForConfirm,
  });
}
