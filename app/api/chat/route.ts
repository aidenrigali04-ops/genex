import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { trackAha } from "@/lib/analytics";
import type { ClipInputMode } from "@/lib/clip-package";
import { isUnlimitedCreditsModeServer } from "@/lib/credits-config";
import {
  formatGenerationContextForPrompt,
  isGenerationContextV1,
  type GenerationContextV1,
} from "@/lib/generation-context";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

const chatBodySchema = z.object({
  messages: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, "At least one message is required."),
  inputMode: z.enum(["clip_first", "generate_first"]).default("generate_first"),
  generationContext: z.unknown().optional(),
  guestCreditsRemaining: z.number().int().optional(),
});

type ProfileCreditsRow = {
  credits: number | null;
  unlimited_credits: boolean | null;
  generation_count: number | null;
};

function buildSystemPrompt(
  inputMode: ClipInputMode,
  generationContext: GenerationContextV1 | null,
): string {
  const ctxBlock = formatGenerationContextForPrompt(generationContext);
  const creatorLines = creatorProfileLinesFromContext(generationContext);

  const clipFirstCore = `You are GenEx AI — a short-form content strategist for TikTok, Reels, and Shorts creators.

The user has provided a YouTube video transcript or video content.
Your job: identify the best clip moments, then make each one post-ready.

Output ALL sections in this EXACT order and format. Use these EXACT headers:

TOP CLIP MOMENTS
[List 3 clip moments with timestamps if available. For each: timestamp range
why it works as a short, hook angle. Format:
• [0:00–0:45] — [one sentence: why this is the best clip]
• [2:10–2:55] — [one sentence: why this works]
• [5:30–6:15] — [one sentence: why this works]]

HOOK (FIRST 3 SECONDS)
[Write 3 hook rewrites — one per clip moment above. Each hook must:
- Start with a pattern interrupt or bold claim
- Be under 15 words
- Create immediate curiosity or tension
Label each: Hook for Clip 1, Hook for Clip 2, Hook for Clip 3]

CLIP SCRIPT (30–60 SECONDS)
[Full script for the strongest clip. Format each beat as:
[VISUAL CUE]: description
[LINE]: spoken line]

CTA (CALL TO ACTION)
[3 CTA variations — soft, medium, direct. One line each.]

CAPTION HOOK + HASHTAGS
[Platform-ready caption (under 150 chars) + 5–8 hashtags]

B-ROLL / VISUAL IDEAS
[5 B-roll suggestions that match the clip topic. One line each.]

CREATOR SIGNALS
FORMAT_TAGS: tag1, tag2, tag3
LENGTH_HINT_SECONDS: 45
HOOK_STRENGTH: high | Reason: [one short phrase explaining why]`;

  const generateFirstCore = `You are GenEx AI — a short-form content strategist for TikTok, Reels, and Shorts creators.

The user has a content idea, topic, or transcript they want turned into a post-ready short.
Your job: write a complete Clip Package — original hooks, script, captions, and B-roll.

Output ALL sections in this EXACT order and format:

HOOK (FIRST 3 SECONDS)
[Write 3 distinct hook options. Each must:
- Be under 15 words
- Start with pattern interrupt, bold claim, or curiosity gap
- Sound completely different from the others (vary the angle)
Number them 1, 2, 3.]

CLIP SCRIPT (30–60 SECONDS)
[Full spoken script for Hook #1. Format:
[VISUAL CUE]: description
[LINE]: spoken line]

CTA (CALL TO ACTION)
[3 variations — soft, medium, direct.]

CAPTION HOOK + HASHTAGS
[Caption under 150 chars + 5–8 hashtags]

B-ROLL / VISUAL IDEAS
[5 B-roll suggestions. One line each.]

CREATOR SIGNALS
FORMAT_TAGS: tag1, tag2, tag3
LENGTH_HINT_SECONDS: 45
HOOK_STRENGTH: high | Reason: [one short phrase]

TOP CLIP MOMENTS
[Skip this section — leave blank or omit for idea-first generations]`;

  const base = inputMode === "clip_first" ? clipFirstCore : generateFirstCore;
  const parts = [base];
  if (ctxBlock.trim()) {
    parts.push("", ctxBlock);
  }
  if (creatorLines) {
    parts.push("", "Creator profile:", creatorLines);
    parts.push("Tailor ALL output to match this creator's voice and audience.");
  }
  parts.push(
    "",
    "Hard rules:",
    "- Start the assistant reply with the first section header exactly as specified (no preamble).",
    "- Use the exact header strings so downstream parsers can split the output.",
  );
  return parts.join("\n");
}

function creatorProfileLinesFromContext(ctx: GenerationContextV1 | null): string {
  if (!ctx) return "";
  const niche = pickAnswer(ctx, ["niche", "Niche"]);
  const tone = pickAnswer(ctx, ["tone_preference", "tone", "Tone"]);
  const hookStyle = pickAnswer(ctx, ["hook_style", "hookStyle", "Hook style"]);
  const lines: string[] = [];
  if (niche) lines.push(`- Niche: ${niche}`);
  if (tone) lines.push(`- Tone: ${tone}`);
  if (hookStyle) lines.push(`- Hook style preference: ${hookStyle}`);
  return lines.join("\n");
}

function pickAnswer(ctx: GenerationContextV1, keys: string[]): string {
  for (const k of keys) {
    const v = ctx.answers[k];
    const s = typeof v === "string" ? v.trim() : "";
    if (s) return s;
  }
  return "";
}

async function refundOneClipCredit(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data } = await supabase
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .maybeSingle();
  const cur = typeof data?.credits === "number" ? data.credits : 0;
  await supabase
    .from("profiles")
    .update({
      credits: cur + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
}

async function bumpGenerationCount(
  supabase: SupabaseClient,
  userId: string,
  previous: number,
): Promise<void> {
  await supabase
    .from("profiles")
    .update({
      generation_count: previous + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
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

  const parsedBody = chatBodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    const msg = parsedBody.error.issues.map((i) => i.message).join(" ");
    return Response.json(
      { error: `${msg} No credits were charged.` },
      { status: 400 },
    );
  }

  const { messages, inputMode, guestCreditsRemaining } = parsedBody.data;
  const generationContext: GenerationContextV1 | null =
    parsedBody.data.generationContext != null &&
    isGenerationContextV1(parsedBody.data.generationContext)
      ? parsedBody.data.generationContext
      : null;

  const uiMessages = messages as unknown as UIMessage[];
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

  let userIdForBilling: string | null = user?.id ?? null;
  let chargedCredit = false;
  let generationCountBefore = 0;
  let hadUnlimitedProfile = false;

  if (userIdForBilling) {
    const uid = userIdForBilling;
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("credits, unlimited_credits, generation_count")
      .eq("id", uid)
      .maybeSingle();

    if (profErr) {
      console.error("[chat] profile read failed", profErr.message);
      return Response.json(
        {
          error:
            "Failed to load your profile. No credits were charged.",
        },
        { status: 500 },
      );
    }

    const row = prof as ProfileCreditsRow | null;
    hadUnlimitedProfile = Boolean(row?.unlimited_credits);
    generationCountBefore =
      typeof row?.generation_count === "number" ? row.generation_count : 0;

    if (!unlimitedServer && !hadUnlimitedProfile) {
      if (
        row &&
        typeof row.credits === "number" &&
        row.credits <= 0
      ) {
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
        console.error("[chat] consume_one_credit failed", rpcErr.message);
        return Response.json(
          {
            error:
              "Failed to reserve credit. No credits were charged.",
          },
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
          {
            error:
              "Failed to reserve credit. No credits were charged.",
          },
          { status: 500 },
        );
      }

      chargedCredit = true;
    }
  }

  const systemPrompt = buildSystemPrompt(inputMode, generationContext);

  let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
  try {
    modelMessages = await convertToModelMessages(uiMessages);
  } catch (e) {
    console.error("[chat] convertToModelMessages failed", e);
    if (chargedCredit && userIdForBilling) {
      try {
        await refundOneClipCredit(supabase, userIdForBilling);
      } catch (refundErr) {
        console.error("[chat] refund after convert failed", refundErr);
      }
    }
    return Response.json(
      {
        error:
          "Invalid message payload. No credits were charged.",
      },
      { status: 400 },
    );
  }

  try {
    const result = streamText({
      model: openai("gpt-4o"),
      system: systemPrompt,
      messages: modelMessages,
      onFinish: async ({ text, finishReason }) => {
        if (!userIdForBilling) return;
        const ok = finishReason === "stop" && Boolean(text?.trim());
        if (!ok) {
          if (chargedCredit) {
            try {
              await refundOneClipCredit(supabase, userIdForBilling);
            } catch (e) {
              console.error("[chat] refund failed", e);
            }
          }
          return;
        }
        if (generationCountBefore === 1) {
          void trackAha(supabase, userIdForBilling, "second_generation");
        }
        try {
          await bumpGenerationCount(
            supabase,
            userIdForBilling,
            generationCountBefore,
          );
        } catch (e) {
          console.error("[chat] generation_count bump failed", e);
        }
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (e) {
    console.error("[chat] streamText failed", e);
    if (chargedCredit && userIdForBilling) {
      try {
        await refundOneClipCredit(supabase, userIdForBilling);
      } catch (refundErr) {
        console.error("[chat] refund after failure failed", refundErr);
      }
    }
    return Response.json(
      {
        error:
          "Generation failed to start. No credits were charged.",
      },
      { status: 500 },
    );
  }
}
