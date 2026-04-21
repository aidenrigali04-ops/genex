import { openai } from "@ai-sdk/openai";
import { APICallError, generateObject } from "ai";
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

/** User-safe copy for `generateObject` / network failures (no stack traces). */
function refinementConversationFailureMessage(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const sc = error.statusCode;
    if (sc === 401 || sc === 403) {
      return "OpenAI rejected the request (invalid API key or access). No credits were charged. If this keeps happening, check OPENAI_API_KEY on the server.";
    }
    if (sc === 429) {
      return "The model provider rate-limited this request. No credits were charged. Try again in a moment.";
    }
    if (sc != null && sc >= 500) {
      return "The model provider had a temporary error. No credits were charged. Please try again.";
    }
  }
  const msg = error instanceof Error ? error.message : String(error);
  const m = msg.toLowerCase();
  if (
    m.includes("no object generated") ||
    m.includes("did not return a response") ||
    m.includes("could not parse") ||
    m.includes("failed to parse") ||
    m.includes("type validation")
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
  return "Generation failed. No credits were charged.";
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

  try {
    const { object } = await generateObject({
      model: openai(modelId),
      schema: resultSchema,
      temperature: 0.45,
      maxOutputTokens: 1600,
      system,
      prompt,
    });

    const coerced = resultSchema.safeParse(object);
    if (!coerced.success) {
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
    if (coerced.data.answerPatches) {
      for (const [k, v] of Object.entries(coerced.data.answerPatches)) {
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
      assistantMessage: coerced.data.assistantMessage.trim(),
      answerPatches:
        Object.keys(filteredPatches).length > 0 ? filteredPatches : undefined,
      readyForConfirm,
    });
  } catch (e) {
    console.error("[refinement-conversation] generateObject failed", e);
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
      },
      { status: 500 },
    );
  }
}
