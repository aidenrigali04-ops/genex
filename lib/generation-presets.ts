export const GENERATION_PRESET_IDS = [
  "viral_hook",
  "storytime",
  "educational",
  "contrarian",
] as const;

export type GenerationPresetId = (typeof GENERATION_PRESET_IDS)[number];

export const GENERATION_PRESET_LABELS: Record<GenerationPresetId, string> = {
  viral_hook: "Viral Hook",
  storytime: "Storytime",
  educational: "Educational",
  contrarian: "Contrarian",
};

export const GENERATION_PRESET_APPEND: Record<GenerationPresetId, string> = {
  viral_hook:
    "Prioritize scroll-stopping pattern interrupts: subvert expectations in the first line, use contrast, curiosity gaps, and bold specifics—never generic hype. Hooks must feel like a hard stop on the thumb-scroll.",
  storytime:
    "Structure the output as narrative with a clear emotional arc: setup → tension or conflict → turn → payoff. Let the listener feel progression; avoid flat lists unless the format demands bullets.",
  educational:
    "Use an authority tone with warm clarity. Lead with one sharp, actionable insight readers can use immediately. Frame value as worth saving / revisiting (without sounding salesy). Prefer concrete steps, numbers, or frameworks over vague advice.",
  contrarian:
    "Challenge a widely held belief or default assumption in the niche. Open with a controversy-driven or tension-first hook that invites disagreement or debate, then earn the take with proof, nuance, or a reframing—avoid empty shock value.",
};

export function isGenerationPresetId(
  value: string,
): value is GenerationPresetId {
  return (GENERATION_PRESET_IDS as readonly string[]).includes(value);
}

export function appendPresetToSystemPrompt(
  base: string,
  preset: GenerationPresetId | undefined,
): string {
  if (!preset) return base;
  const block = GENERATION_PRESET_APPEND[preset];
  return `${base}\n\n--- Active style preset ---\n${block}`;
}
