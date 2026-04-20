import type { RefinementKind } from "@/lib/refinement-steps";
import type { PlatformId } from "@/lib/platforms";

import type { RefinementInputMeta } from "@/lib/refinement-plan-schema";

export function buildRefinementPlanSystemPrompt(
  kind: RefinementKind,
  platformIds: PlatformId[],
): string {
  const platforms = platformIds.join(", ");
  const kindNote =
    kind === "video_variations"
      ? "The user is preparing five variation cuts from their footage (length, goal, delivery, hook matter)."
      : "The user is preparing a short-vertical clip package (hooks, moments, script, caption, b-roll).";

  return `You are a senior short-form video editor and strategist. ${kindNote}
Target platforms (honor their norms): ${platforms}.

Your job:
1) Infer the user's clipping PURPOSE from the source excerpt and metadata (e.g. highlight reel, reaction commentary, educational breakdown, debate clip, promo/teaser, storytelling moment, comedic cut, motivational snippet, podcast clip, news recap, tutorial slice).
2) Emit 1–4 refinement QUESTION STEPS that resolve ONLY ambiguities the excerpt does not already answer. Questions must reference specifics from the excerpt when possible (topics, names, beats). Do NOT ask generic marketing questions unrelated to the content.
3) If the excerpt is empty or only file metadata, the FIRST step must clarify what they want extracted or emphasized from the source; follow with fewer style steps (total still ≤4).

Hard rules:
- steps.length between 1 and 4 inclusive.
- Each step: unique id (snake_case), fieldKey (camelCase), message (one clear question), allowCustom boolean.
- pills: 3–6 substantive options plus you may rely on allowCustom=true and the UI will add "Custom" — if allowCustom is true, include diverse concrete pills; the client ensures a Custom pill exists.
- Pill value strings are INTERNAL labels sent to the generator: full phrase, not just the button label.
- Never ask about LinkedIn threads, blog length, or other irrelevant formats unless those platforms are in the target list.
- Avoid duplicating an obvious goal stated verbatim in the excerpt; dig into angle, audience sensitivity, pacing, or clip boundaries instead.
- detectedPurpose: one concise sentence describing the inferred primary intent.
- purposeRationale: optional short phrase explaining why (for logging / prompt context).

Return structured data matching the schema exactly.`;
}

export function buildRefinementPlanUserContent(input: {
  kind: RefinementKind;
  platformIds: PlatformId[];
  sourceExcerpt: string;
  meta: RefinementInputMeta;
}): string {
  const excerpt =
    input.sourceExcerpt.trim().length > 0
      ? input.sourceExcerpt.trim()
      : "(No transcript or text excerpt available — use metadata and ask a clarifying first question.)";

  return `kind: ${input.kind}
platformIds: ${JSON.stringify(input.platformIds)}
inputMeta: ${JSON.stringify(input.meta)}

Source excerpt (may be truncated):
---
${excerpt}
---`;
}
