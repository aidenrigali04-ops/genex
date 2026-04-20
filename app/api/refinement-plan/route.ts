import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import { isPlatformId, type PlatformId } from "@/lib/platforms";
import {
  buildRefinementPlanSystemPrompt,
  buildRefinementPlanUserContent,
} from "@/lib/refinement-plan-prompt";
import {
  modelOutputToRefinementSteps,
  refinementInputMetaSchema,
  refinementPlanModelOutputSchema,
  REFINEMENT_PLAN_MAX_EXCERPT_CHARS,
} from "@/lib/refinement-plan-schema";
import {
  buildRefinementSteps,
  type RefinementKind,
  type RefinementStepDef,
} from "@/lib/refinement-steps";

export const maxDuration = 60;

const bodySchema = z.object({
  kind: z.enum(["video_variations", "text_generation"]),
  platformIds: z.array(z.string()).min(1).max(12),
  sourceExcerpt: z.string().max(REFINEMENT_PLAN_MAX_EXCERPT_CHARS + 100),
  inputMeta: refinementInputMetaSchema,
});

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

function fallbackPayload(
  kind: RefinementKind,
  platformIds: PlatformId[],
  reason: string,
): {
  planSource: "fallback";
  steps: RefinementStepDef[];
  detectedPurpose: string;
  purposeRationale?: string;
  fallbackReason: string;
} {
  return {
    planSource: "fallback",
    steps: buildRefinementSteps(kind, platformIds),
    detectedPurpose: "",
    purposeRationale: undefined,
    fallbackReason: reason,
  };
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const kind = parsed.data.kind as RefinementKind;
  const platformIds = normalizePlatforms(parsed.data.platformIds);
  if (platformIds.length === 0) {
    return Response.json(
      { error: "At least one valid platform id is required." },
      { status: 400 },
    );
  }

  const excerpt = parsed.data.sourceExcerpt.slice(0, REFINEMENT_PLAN_MAX_EXCERPT_CHARS);
  const inputMeta = parsed.data.inputMeta;

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      fallbackPayload(kind, platformIds, "missing_openai_key"),
    );
  }

  const modelId =
    process.env.OPENAI_REFINEMENT_PLAN_MODEL?.trim() || "gpt-4o-mini";

  try {
    const { object } = await generateObject({
      model: openai(modelId),
      schema: refinementPlanModelOutputSchema,
      temperature: 0.35,
      maxOutputTokens: 1600,
      system: buildRefinementPlanSystemPrompt(kind, platformIds),
      prompt: buildRefinementPlanUserContent({
        kind,
        platformIds,
        sourceExcerpt: excerpt,
        meta: inputMeta,
      }),
    });

    const coerced = refinementPlanModelOutputSchema.safeParse(object);
    if (!coerced.success) {
      return Response.json(
        fallbackPayload(kind, platformIds, "schema_revalidate_failed"),
      );
    }

    const steps = modelOutputToRefinementSteps(coerced.data);
    if (!steps) {
      return Response.json(
        fallbackPayload(kind, platformIds, "step_normalization_failed"),
      );
    }

    return Response.json({
      planSource: "llm" as const,
      steps,
      detectedPurpose: coerced.data.detectedPurpose.trim(),
      purposeRationale: coerced.data.purposeRationale?.trim() || undefined,
    });
  } catch (e) {
    console.error("[refinement-plan]", e);
    return Response.json(
      fallbackPayload(
        kind,
        platformIds,
        e instanceof Error ? e.message : "generate_object_failed",
      ),
    );
  }
}
