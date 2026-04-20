import { z } from "zod";

import type { RefinementStepDef } from "@/lib/refinement-steps";

/** Server-side cap on excerpt bytes/chars accepted by refinement-plan API. */
export const REFINEMENT_PLAN_MAX_EXCERPT_CHARS = 14_000;

export const refinementInputMetaSchema = z.object({
  inputMode: z.enum(["text", "url", "file"]),
  url: z.string().max(2048).optional(),
  fileName: z.string().max(500).optional(),
  mimeType: z.string().max(200).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

export type RefinementInputMeta = z.infer<typeof refinementInputMetaSchema>;

const pillSchema = z.object({
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(240),
});

const stepSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/i, "id must be alphanumeric/underscore"),
  message: z.string().min(8).max(520),
  fieldKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "fieldKey must be camelCase or snake_case"),
  pills: z.array(pillSchema).min(3).max(8),
  allowCustom: z.boolean(),
});

export const refinementPlanModelOutputSchema = z.object({
  detectedPurpose: z.string().min(3).max(400),
  purposeRationale: z.string().max(600).optional(),
  steps: z.array(stepSchema).min(1).max(4),
});

export type RefinementPlanModelOutput = z.infer<typeof refinementPlanModelOutputSchema>;

function ensureCustomPill(step: RefinementPlanModelOutput["steps"][number]): {
  label: string;
  value: string;
}[] {
  const pills = [...step.pills];
  if (step.allowCustom && !pills.some((p) => p.value === "__custom__")) {
    pills.push({ label: "Custom", value: "__custom__" });
  }
  return pills;
}

/** Maps validated model output to UI defs; returns null if unusable. */
export function modelOutputToRefinementSteps(
  out: RefinementPlanModelOutput,
): RefinementStepDef[] | null {
  const steps: RefinementStepDef[] = [];
  for (const s of out.steps) {
    const pills = ensureCustomPill(s);
    if (pills.length < 3) return null;
    steps.push({
      id: s.id,
      message: s.message.trim(),
      fieldKey: s.fieldKey,
      pills,
      allowCustom: s.allowCustom,
    });
  }
  return steps.length ? steps : null;
}
