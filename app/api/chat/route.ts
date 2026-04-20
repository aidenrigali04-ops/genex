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
  remainingCreditsForDisplay,
  type ProfileCreditsRow,
} from "@/lib/profile-credits-display";
import {
  formatGenerationContextForPrompt,
  isGenerationContextV1,
  type GenerationContextV1,
} from "@/lib/generation-context";
import {
  buildCreatorMemoryBlock,
  extractLastUserTextFromUiMessages,
} from "@/lib/chat-memory-block";
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

type ProfileCreditsRowChat = ProfileCreditsRow & {
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
[Write 3 DISTINCT hook rewrites — one per clip moment above. Each hook MUST use a different pattern from this taxonomy:
1. PATTERN-INTERRUPT: Start with a false assumption, then shatter it in ≤10 words
   Example: "Everyone says [X]. They're completely wrong. Here's why."
2. CURIOSITY GAP: State the outcome before the reason, withhold the method
   Example: "I [achieved result] without [conventional method]. Here's the actual reason."
3. IDENTITY CHALLENGE: Call out the viewer's current belief or behavior directly
   Example: "If you're still doing [X], you're losing [Y] every single day."
Label each hook with its pattern type: PATTERN-INTERRUPT / CURIOSITY-GAP / IDENTITY-CHALLENGE
Every hook must be ≤15 words. No exceptions.]

CLIP SCRIPT (30–60 SECONDS)
[Full script for the strongest clip. Every line gets a PACING tag:
[HOOK-LINE | FAST]: First spoken line — under 8 words, punchy, spoken fast
[VISUAL CUE]: what the camera/B-roll shows
[BUILD | MEDIUM]: 1-2 sentences establishing the problem or promise
[VISUAL CUE]: B-roll change
[PROOF | MEDIUM]: 1-2 sentences of evidence, story, or demonstration
[VISUAL CUE]: B-roll change
[RESOLUTION | SLOW]: The payoff line — 1 sentence, spoken with weight
[CTA-TEASE | FAST]: 1 line teasing what comes next or directing action
The pacing tags (FAST / MEDIUM / SLOW) tell editors how to cut the audio.]

CTA (CALL TO ACTION)
[3 CTA variations — soft, medium, direct. One line each.]

CAPTION HOOK + HASHTAGS
[Platform-ready caption (under 150 chars) + 5–8 hashtags]

B-ROLL / VISUAL IDEAS
[5 B-roll suggestions that match the clip topic. One line each.
End with a 6th line prefixed WILDCARD: — a genuinely unexpected angle (contrarian, underdog, or format inversion). Never restate Hook #1 or any hook rewrite.]

CREATOR SIGNALS
FORMAT_TAGS: tag1, tag2, tag3
LENGTH_HINT_SECONDS: 45
HOOK_STRENGTH: high | Reason: [name the mechanism, e.g. pattern-interrupt + curiosity-gap — not generic "engaging"]`;

  const generateFirstCore = `You are GenEx AI — a short-form content strategist for TikTok, Reels, and Shorts creators.

The user has a content idea, topic, or transcript they want turned into a post-ready short.
Your job: write a complete Clip Package — original hooks, script, captions, and B-roll.

Output ALL sections in this EXACT order and format:

HOOK (FIRST 3 SECONDS)
[Write 3 DISTINCT hook options. Each hook MUST use a different pattern from this taxonomy:
1. PATTERN-INTERRUPT: Start with a false assumption, then shatter it in ≤10 words
   Example: "Everyone says [X]. They're completely wrong. Here's why."
2. CURIOSITY GAP: State the outcome before the reason, withhold the method
   Example: "I [achieved result] without [conventional method]. Here's the actual reason."
3. IDENTITY CHALLENGE: Call out the viewer's current belief or behavior directly
   Example: "If you're still doing [X], you're losing [Y] every single day."
Label each hook with its pattern type: PATTERN-INTERRUPT / CURIOSITY-GAP / IDENTITY-CHALLENGE
Every hook must be ≤15 words. No exceptions.]

CLIP SCRIPT (30–60 SECONDS)
[Full spoken script for Hook #1 using this format. Every line gets a PACING tag:
[HOOK-LINE | FAST]: First spoken line — under 8 words, punchy, spoken fast
[VISUAL CUE]: what the camera/B-roll shows
[BUILD | MEDIUM]: 1-2 sentences establishing the problem or promise
[VISUAL CUE]: B-roll change
[PROOF | MEDIUM]: 1-2 sentences of evidence, story, or demonstration
[VISUAL CUE]: B-roll change
[RESOLUTION | SLOW]: The payoff line — 1 sentence, spoken with weight
[CTA-TEASE | FAST]: 1 line teasing what comes next or directing action
The pacing tags (FAST / MEDIUM / SLOW) tell editors how to cut the audio.]

CTA (CALL TO ACTION)
[3 variations — soft, medium, direct.]

CAPTION HOOK + HASHTAGS
[Caption under 150 chars + 5–8 hashtags]

B-ROLL / VISUAL IDEAS
[5 B-roll suggestions. One line each.
End with a 6th line prefixed WILDCARD: — a genuinely unexpected angle (contrarian, underdog, or format inversion). Never restate Hook #1.]

CREATOR SIGNALS
FORMAT_TAGS: tag1, tag2, tag3
LENGTH_HINT_SECONDS: 45
HOOK_STRENGTH: high | Reason: [name the mechanism, e.g. identity-challenge — not generic "strong"]

TOP CLIP MOMENTS
[Skip this section — leave blank or omit for idea-first generations]`;

  const base = inputMode === "clip_first" ? clipFirstCore : generateFirstCore;
  const parts = [base];
  if (ctxBlock.trim()) {
    parts.push("", ctxBlock);
  }
  const detectedPurpose = generationContext?.inferredClipPurpose?.trim();
  const purposeRationale = generationContext?.inferredPurposeRationale?.trim();
  if (detectedPurpose) {
    parts.push(
      "",
      `Detected clip purpose: ${detectedPurpose}`,
      ...(purposeRationale ? [`Rationale: ${purposeRationale}`] : []),
      "Prioritize hooks, script angle, and CTA style that match this purpose.",
      "If purpose is EDUCATE: lead with clarity. INSPIRE: lead with transformation.",
      "ENTERTAIN: lead with personality. PROMOTE: lead with the offer hook.",
      "GROW: lead with the follow/subscribe CTA. CONVERT: lead with the pain point.",
    );
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
    "- HOOK_STRENGTH reasoning must reference one of: pattern-interrupt, curiosity-gap, identity-challenge, controversy, or social-proof. Never use vague words like \"engaging\" or \"strong\" alone — always name the specific mechanism.",
    "- The WILDCARD line (under B-ROLL / VISUAL IDEAS) must be genuinely unexpected — contrarian angle, underdog framing, or format inversion — never a paraphrase of Hook #1.",
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
  await supabase.rpc("refund_one_credit", { p_user_id: userId });
}

type IncrementGenerationStreakResult = {
  generation_count?: number;
  current_streak?: number;
  longest_streak?: number;
  is_first_gen?: boolean;
  error?: string;
};

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

  const userIdForBilling: string | null = user?.id ?? null;
  let chargedCredit = false;
  let generationCountBefore = 0;
  let hadUnlimitedProfile = false;

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
      console.error("[chat] profile read failed", profErr.message);
      return Response.json(
        {
          error:
            "Failed to load your profile. No credits were charged.",
        },
        { status: 500 },
      );
    }

    const row = prof as ProfileCreditsRowChat | null;
    hadUnlimitedProfile = Boolean(row?.unlimited_credits);
    generationCountBefore =
      typeof row?.generation_count === "number" ? row.generation_count : 0;

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

  let memoryBlock = "";
  if (userIdForBilling) {
    const inputContent = extractLastUserTextFromUiMessages(uiMessages);
    try {
      memoryBlock = await buildCreatorMemoryBlock(
        supabase,
        userIdForBilling,
        inputContent,
      );
    } catch {
      memoryBlock = "";
    }
  }

  const baseSystemPrompt = buildSystemPrompt(inputMode, generationContext);
  const systemPrompt =
    memoryBlock.length > 0
      ? `${baseSystemPrompt}\n\n${memoryBlock}`
      : baseSystemPrompt;

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

  let isFirstGen = false;
  let newStreak = 0;

  if (userIdForBilling) {
    if (generationCountBefore === 1) {
      void trackAha(supabase, userIdForBilling, "second_generation");
    }

    const { data: streakData, error: streakError } = await supabase.rpc(
      "increment_generation_streak",
      { p_user_id: userIdForBilling },
    );

    if (!streakError && streakData) {
      const row = streakData as IncrementGenerationStreakResult;
      if (!row.error) {
        isFirstGen = row.is_first_gen === true;
        newStreak =
          typeof row.current_streak === "number" ? row.current_streak : 0;

        if (newStreak === 3) {
          void trackAha(supabase, userIdForBilling, "streak_3_days");
        }
        if (newStreak === 7) {
          void trackAha(supabase, userIdForBilling, "streak_7_days");
        }
      }
    } else if (streakError) {
      console.error(
        "[chat] increment_generation_streak failed",
        streakError.message,
      );
    }
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
      },
    });

    const streamResponse = result.toUIMessageStreamResponse();
    const headers = new Headers(streamResponse.headers);
    headers.set("x-genex-is-first-gen", isFirstGen ? "1" : "0");
    headers.set("x-genex-streak", String(newStreak));

    return new Response(streamResponse.body, {
      status: streamResponse.status,
      headers,
    });
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
