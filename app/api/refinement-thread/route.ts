import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isUnlimitedCreditsModeServer } from "@/lib/credits-config";
import {
  remainingCreditsForDisplay,
  type ProfileCreditsRow,
} from "@/lib/profile-credits-display";
import { isPlatformId, type PlatformId } from "@/lib/platforms";
import {
  buildRefinementSteps,
  type RefinementKind,
} from "@/lib/refinement-steps";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const bodySchema = z.object({
  kind: z.enum(["video_variations", "text_generation"]),
  platformIds: z.array(z.string()).min(1).max(12),
  inputSummary: z.string().max(4000),
  currentFieldKey: z.string().min(1).max(64),
  currentQuestion: z.string().min(1).max(1200),
  answersPartial: z.record(z.string(), z.string()).default({}),
  userMessage: z.string().min(1).max(4000),
  guestCreditsRemaining: z.number().int().optional(),
});

const resultSchema = z.object({
  assistantMessage: z.string().min(1).max(2500),
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

function buildRefinementThreadSystemPrompt(allowedFieldKeys: string[]): string {
  const keys = allowedFieldKeys.join(", ");
  return `You are Ada, helping a creator answer structured pre-generation questions for a short-form product.

Rules:
- Reply with ONE short assistant message (clarify, reframe, or give 1–2 concrete suggestions). Max ~120 words.
- The user may ask follow-ups in plain language.
- Optionally include answerPatches ONLY for these known field keys: ${keys}.
- Each patch value must be a concise string suitable to store as the user's answer (what downstream editors read). No markdown lists in patch values unless the UI already expects them.
- Never add keys outside the allowed list. Never repeat the entire questionnaire.
- If the user is vague, ask one focused follow-up in your assistantMessage instead of guessing patches.
- Stay on-topic: clip length, goal, delivery, hooks, platforms — not general life advice.`;
}

export async function POST(req: Request): Promise<Response> {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      {
        error:
          "Missing OPENAI_API_KEY in environment. No credits were charged.",
      },
      { status: 500 },
    );
  }

  const supabase = await createClient();
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
    currentFieldKey,
    currentQuestion,
    answersPartial,
    userMessage,
    guestCreditsRemaining,
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
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
  }

  const steps = buildRefinementSteps(kind as RefinementKind, platformIds);
  const allowedFieldKeys = steps.map((s) => s.fieldKey);
  if (!allowedFieldKeys.includes(currentFieldKey)) {
    return Response.json(
      { error: "Invalid currentFieldKey for this refinement flow." },
      { status: 400 },
    );
  }

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
      console.error("[refinement-thread] profile read failed", profErr.message);
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
        console.error("[refinement-thread] consume_one_credit failed", rpcErr.message);
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
    process.env.OPENAI_REFINEMENT_THREAD_MODEL?.trim() || "gpt-4o-mini";

  const userPayload = {
    inputSummary: inputSummary.slice(0, 4000),
    currentFieldKey,
    currentQuestion: currentQuestion.slice(0, 1200),
    answersSoFar: answersPartial,
    userMessage: userMessage.slice(0, 4000),
  };

  try {
    const { object } = await generateObject({
      model: openai(modelId),
      schema: resultSchema,
      temperature: 0.4,
      maxOutputTokens: 1200,
      system: buildRefinementThreadSystemPrompt(allowedFieldKeys),
      prompt: `Context (JSON):\n${JSON.stringify(userPayload)}`,
    });

    const coerced = resultSchema.safeParse(object);
    if (!coerced.success) {
      if (chargedCredit && userIdForBilling) {
        try {
          await refundOneClipCredit(supabase, userIdForBilling);
        } catch (e) {
          console.error("[refinement-thread] refund after schema fail", e);
        }
      }
      return Response.json(
        { error: "Invalid model output. No credits were charged." },
        { status: 500 },
      );
    }

    const allowed = new Set(allowedFieldKeys);
    const filteredPatches: Record<string, string> = {};
    if (coerced.data.answerPatches) {
      for (const [k, v] of Object.entries(coerced.data.answerPatches)) {
        if (allowed.has(k) && typeof v === "string" && v.trim()) {
          filteredPatches[k] = v.trim().slice(0, 2000);
        }
      }
    }

    return Response.json({
      assistantMessage: coerced.data.assistantMessage.trim(),
      answerPatches:
        Object.keys(filteredPatches).length > 0 ? filteredPatches : undefined,
    });
  } catch (e) {
    console.error("[refinement-thread] generateObject failed", e);
    if (chargedCredit && userIdForBilling) {
      try {
        await refundOneClipCredit(supabase, userIdForBilling);
      } catch (refundErr) {
        console.error("[refinement-thread] refund failed", refundErr);
      }
    }
    return Response.json(
      {
        error:
          "Generation failed. No credits were charged.",
      },
      { status: 500 },
    );
  }
}
