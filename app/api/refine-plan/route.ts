import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import { isPlatformId, type PlatformId } from "@/lib/platforms";
import type { RefinementStepDef } from "@/lib/refinement-steps";

export const maxDuration = 60;

const PURPOSES = [
  "EDUCATE",
  "INSPIRE",
  "ENTERTAIN",
  "PROMOTE",
  "GROW",
  "CONVERT",
] as const;

const voiceProfileSchema = z
  .object({
    niche: z.string().nullable().optional(),
    tone_preference: z.string().nullable().optional(),
    hook_style: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const bodySchema = z.object({
  inputContent: z.string().max(4000),
  inputMode: z.enum(["url", "text"]),
  platformIds: z.array(z.string()).min(1).max(12),
  voiceProfile: voiceProfileSchema,
});

const questionSchema = z.object({
  id: z.string().min(1).max(64),
  fieldKey: z.string().min(1).max(64),
  message: z.string().min(1).max(500),
});

const modelOutputSchema = z.object({
  detectedPurpose: z.enum(PURPOSES),
  purposeRationale: z.string().min(1).max(600),
  questions: z.array(questionSchema).min(3).max(4),
});

const REFINE_PLAN_SYSTEM = `You are a short-form content strategist helping a creator get the most from their content.

You will receive a piece of content (a YouTube URL, transcript, or raw idea).
Your job is to:

1. DETECT the PRIMARY PURPOSE of this content. Choose exactly one:
   EDUCATE   — teaching, tutorial, how-to, knowledge sharing
   INSPIRE   — transformation, mindset, motivation, personal story
   ENTERTAIN — humor, personality, reaction, storytelling
   PROMOTE   — product, service, offer, brand
   GROW      — follower/community growth, CTA-heavy
   CONVERT   — lead generation, sales, DM funnel

2. Write a one-sentence rationale for your purpose classification.

3. Generate 3–4 refinement questions — one per "vector" you still need answered
   to produce the strongest possible clip for this creator.

   Vector order (prioritize whichever you know least about):
   A. AUDIENCE   — who specifically is this for, what do they want or fear
   B. HOOK ANGLE — the tension, surprise, or emotion that makes it stop-scroll
   C. INTENT     — what the creator wants the viewer to DO or FEEL after watching
   D. VOICE      — tone, style, delivery energy

   QUESTION RULES:
   - Each question must be SHORT (under 20 words) and feel like a creative director, not a form.
   - Do NOT ask about anything already answered by the voiceProfile (niche, tone, hook_style).
   - If the inputContent is a short idea (< 100 chars), ask broader discovery questions.
   - If inputContent is a long transcript (> 500 chars), ask sharper refinement questions.
   - Questions should be OPEN-ENDED — typed answers, not yes/no.
   - Do NOT offer pills or multiple choice in this output — the UI handles that separately.
   - After 3–4 good questions you have enough. Never return more than 4.

4. Return structured data with:
   - detectedPurpose: one of EDUCATE | INSPIRE | ENTERTAIN | PROMOTE | GROW | CONVERT
   - purposeRationale: one sentence
   - questions: array of { id, fieldKey, message } — 3 to 4 items

IMPORTANT for the schema you must satisfy:
- fieldKey must be camelCase (e.g. audiencePersona, hookAngle).
- id must be a short unique key (e.g. audience, hookAngle).`;

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

function mapQuestionsToSteps(
  questions: z.infer<typeof modelOutputSchema>["questions"],
): RefinementStepDef[] {
  return questions.map((q) => ({
    id: q.id.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 64) || "question",
    fieldKey:
      q.fieldKey.replace(/[^a-zA-Z0-9_]/g, "").replace(/^[0-9]+/, "") ||
      `refineAnswer${q.id.replace(/\W/g, "") || "x"}`,
    message: q.message.trim(),
    pills: [],
    allowCustom: true,
  }));
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({
      data: null,
      error: "Invalid JSON body",
    });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({
      data: null,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }

  const inputContent = parsed.data.inputContent.slice(0, 4000);
  const platformIds = normalizePlatforms(parsed.data.platformIds);
  if (platformIds.length === 0) {
    return Response.json({
      data: null,
      error: "At least one valid platform id is required.",
    });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({
      data: null,
      error: "Missing OPENAI_API_KEY in environment.",
    });
  }

  const vp = parsed.data.voiceProfile;
  const voiceBlock =
    vp && (vp.niche || vp.tone_preference || vp.hook_style)
      ? `\nVoice profile (do not ask about fields already covered here):\n${JSON.stringify(
          {
            niche: vp.niche ?? null,
            tone_preference: vp.tone_preference ?? null,
            hook_style: vp.hook_style ?? null,
          },
          null,
          2,
        )}\n`
      : "";

  const userPrompt = `inputMode: ${parsed.data.inputMode}
targetPlatforms: ${platformIds.join(", ")}
${voiceBlock}
inputContent:
---
${inputContent}
---`;

  try {
    const { object } = await generateObject({
      model: openai("gpt-4o"),
      schema: modelOutputSchema,
      temperature: 0.4,
      maxOutputTokens: 1200,
      system: REFINE_PLAN_SYSTEM,
      prompt: userPrompt,
    });

    const coerced = modelOutputSchema.safeParse(object);
    if (!coerced.success) {
      return Response.json({
        data: null,
        error: "Model output failed validation.",
      });
    }

    const steps = mapQuestionsToSteps(coerced.data.questions);
    if (steps.length < 3) {
      return Response.json({
        data: null,
        error: "Not enough refinement questions were produced.",
      });
    }

    return Response.json({
      data: {
        detectedPurpose: coerced.data.detectedPurpose,
        purposeRationale: coerced.data.purposeRationale.trim(),
        steps,
      },
      error: null,
    });
  } catch (e) {
    console.error("[refine-plan]", e);
    const msg = e instanceof Error ? e.message : "Refine plan failed";
    return Response.json({
      data: null,
      error: msg,
    });
  }
}
