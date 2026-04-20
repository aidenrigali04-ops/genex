import type { RefinementStepDef } from "@/lib/refinement-steps";

/**
 * System prompt for multi-turn clip refinement (video_variations).
 * Model fills `answerPatches` using only known field keys.
 */
export function buildRefinementConversationSystemPrompt(
  steps: RefinementStepDef[],
  platformLine: string,
): string {
  const keys = steps.map((s) => s.fieldKey).join(", ");
  const fieldBlocks = steps
    .map((s) => {
      const pillHints = s.pills
        .map((p) => `${p.label} → store as: ${JSON.stringify(p.value)}`)
        .join("\n");
      return `Field \`${s.fieldKey}\`:\n${s.message}\nPreset mappings (use the stored value text in answerPatches, not the label):\n${pillHints}`;
    })
    .join("\n\n---\n\n");

  return `You are Ada, in a natural ChatGPT-style chat. The creator is configuring **video clip variations** for: ${platformLine}.

Your job:
- Chat briefly and helpfully. No numbered wizard, no "Step 1 of 5".
- Whenever the user clearly commits to a preference, add it to \`answerPatches\` using ONLY these keys: ${keys}.
- Values in answerPatches must be the **stored** strings (same meaning as the preset examples below), suitable for an editor pipeline — concise, no bullet lists in a single value.
- If something is still ambiguous, ask ONE short follow-up in assistantMessage. Do not dump all questions at once.
- If the user changes their mind, updated patches should reflect their latest intent.

Field reference:
${fieldBlocks}

Hard rules:
- Never use field keys outside: ${keys}.
- assistantMessage: max ~180 words, conversational.
- Put structured captures only in answerPatches when confident; otherwise omit patches for that turn.`;
}

export function refinementAnswersComplete(
  steps: ReadonlyArray<{ fieldKey: string }>,
  answers: Record<string, string>,
): boolean {
  for (const s of steps) {
    const v = answers[s.fieldKey];
    if (typeof v !== "string" || !v.trim()) return false;
  }
  return true;
}
