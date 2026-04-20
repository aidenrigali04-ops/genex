import OpenAI from "openai";
import { z } from "zod";

const YOUTUBE_HOST =
  /youtube\.com\/|youtu\.be\/|youtube-nocookie\.com\/|m\.youtube\.com\//i;

export const clipIntentSchema = z.object({
  task_type: z.enum(["clip_video", "describe_idea", "refine_clip"]),
  sub_goals: z.array(z.string().max(200)).max(8),
  constraints: z.array(z.string().max(200)).max(10),
  tone: z.string().max(80),
  output_format: z.enum(["short_vertical_video"]),
  must_cite: z.boolean(),
  refinement_target: z.enum(["none", "prior_output", "new_task"]),
});

export type ClipIntent = z.infer<typeof clipIntentSchema>;

export type ClipEngineBundle = {
  version: 1;
  intent: ClipIntent;
  rolling_summary: string;
  planner_context_block: string;
  hook_style_resolved: string | null;
  evaluated: { pass: boolean; notes: string[] };
  intent_source: "heuristic" | "heuristic+openai" | "fallback";
  /** Vector top-k snippets (same user) merged into planner context. */
  retrieved_memories?: string[];
  /** Tool registry outputs (e.g. YouTube oEmbed) merged into planner context. */
  tool_context_block?: string;
};

function detectYoutube(script: string): boolean {
  return YOUTUBE_HOST.test(script);
}

function detectRefinement(script: string, recentExcerpts: string[]): boolean {
  if (recentExcerpts.length === 0) return false;
  if (script.trim().length > 280) return false;
  return /\b(better|shorter|longer|change|again|more|tighten|edit|redo|fix)\b/i.test(
    script,
  );
}

function heuristicSubGoals(script: string): string[] {
  const lines = script
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const line of lines.slice(0, 5)) {
    if (line.length > 12) out.push(line.slice(0, 180));
  }
  if (out.length === 0) {
    out.push("Produce a coherent short vertical clip from the user script.");
  }
  return out.slice(0, 6);
}

function heuristicTone(script: string): string {
  if (/!{2,}|\b(OMG|WOW|INSANE|CRAZY)\b/i.test(script)) return "high-energy";
  if (/\b(calm|gentle|soft|meditative)\b/i.test(script)) return "calm";
  if (/\b(professional|corporate|formal)\b/i.test(script)) return "professional";
  return "clear and conversational";
}

function hookStyleFromIntent(intent: ClipIntent, script: string): string | null {
  const blob = `${script} ${intent.sub_goals.join(" ")}`.toLowerCase();
  if (/\b(curiosity|curious|why|secret|hidden)\b/.test(blob)) return "curiosity";
  if (/\b(contrarian|wrong|myth|debunk)\b/.test(blob)) return "contrarian";
  if (/\b(viral|tiktok|reels|hook)\b/.test(blob)) return "viral";
  return null;
}

export function buildHeuristicIntent(
  script: string,
  recentExcerpts: string[],
): ClipIntent {
  const yt = detectYoutube(script);
  const refine = detectRefinement(script, recentExcerpts);
  const task_type: ClipIntent["task_type"] = refine
    ? "refine_clip"
    : yt
      ? "clip_video"
      : "describe_idea";

  return clipIntentSchema.parse({
    task_type,
    sub_goals: heuristicSubGoals(script),
    constraints: [
      "Vertical short-form (9:16).",
      "Voiceover length must align with 28–55s assembled runtime.",
      ...(yt
        ? ["User supplied a YouTube URL — treat transcript/topic as primary source."]
        : []),
    ],
    tone: heuristicTone(script),
    output_format: "short_vertical_video",
    must_cite: yt && /\b(cite|source|link|url)\b/i.test(script),
    refinement_target: refine ? "prior_output" : "new_task",
  });
}

async function refineIntentWithOpenAI(
  script: string,
  heuristic: ClipIntent,
): Promise<ClipIntent | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;

  const openai = new OpenAI({ apiKey: key });
  const system = `You normalize user intent for an AI short-video clipping pipeline.
Return ONLY valid JSON matching this shape:
{
  "task_type": "clip_video" | "describe_idea" | "refine_clip",
  "sub_goals": string[],
  "constraints": string[],
  "tone": string,
  "output_format": "short_vertical_video",
  "must_cite": boolean,
  "refinement_target": "none" | "prior_output" | "new_task"
}
Rules:
- task_type clip_video when input is mainly a YouTube URL or asks to clip/extract from a long video.
- describe_idea when the user describes an original video idea without a clear long-form source.
- refine_clip when the user is clearly iterating on a previous Ada output (short edit instructions).
- must_cite true only if the user explicitly requires citations to external sources.
- Keep sub_goals to max 6 short strings; constraints max 8 short strings.`;

  const user = `Heuristic draft (may fix):\n${JSON.stringify(heuristic)}\n\nUser script:\n${script.slice(0, 6000)}`;

  try {
    const res = await openai.chat.completions.create({
      model: process.env.OPENAI_CLIP_INTENT_MODEL?.trim() || "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 500,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    const raw = res.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = clipIntentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function assemblePlannerContextBlock(
  script: string,
  intent: ClipIntent,
  rollingSummary: string,
  retrievedMemories: string[],
  toolContextBlock: string,
): string {
  const lines = [
    "--- Clip session context (honor; do not contradict) ---",
    `Task type: ${intent.task_type}`,
    `Refinement: ${intent.refinement_target}`,
    `Tone: ${intent.tone}`,
    `Output: ${intent.output_format}`,
    `Must cite sources in VO: ${intent.must_cite ? "yes" : "no"}`,
    `Sub-goals:\n${intent.sub_goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}`,
    `Constraints:\n${intent.constraints.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
  ];
  if (toolContextBlock.trim()) {
    lines.push(toolContextBlock.trim());
  }
  if (retrievedMemories.length > 0) {
    lines.push(
      `Retrieved prior prompts (semantic):\n${retrievedMemories.map((m, i) => `${i + 1}. ${m}`).join("\n")}`,
    );
  }
  if (rollingSummary.trim()) {
    lines.push(`Rolling thread memory:\n${rollingSummary}`);
  }
  lines.push("--- End context ---");
  const block = lines.join("\n");
  return block.length > 2800 ? `${block.slice(0, 2797)}...` : block;
}

export function evaluateClipTurn(
  script: string,
  intent: ClipIntent,
): { pass: boolean; notes: string[] } {
  const notes: string[] = [];
  if (intent.sub_goals.length === 0) {
    notes.push("No sub-goals after normalization — defaulted in planner.");
  }
  if (intent.must_cite && !YOUTUBE_HOST.test(script) && !/\bhttps?:\/\//i.test(script)) {
    notes.push("must_cite is true but script has no obvious URL — generation may be under-specified.");
  }
  if (script.trim().length < 20) {
    return { pass: false, notes: [...notes, "Script too short for reliable planning."] };
  }
  return { pass: true, notes };
}

export type RunClipEngineInput = {
  script: string;
  /** Short excerpts from recent completed jobs (most recent first). */
  recentScriptExcerpts: string[];
  /** Vector memory top-k (same user). */
  retrievedMemories?: string[];
  /** Pre-rendered tool block (YouTube oEmbed, etc.). */
  toolContextBlock?: string;
};

export async function runTextVideoClipEngine(
  input: RunClipEngineInput,
): Promise<ClipEngineBundle> {
  const excerpts = input.recentScriptExcerpts.map((s) => s.trim().slice(0, 200)).filter(Boolean);
  const retrieved = (input.retrievedMemories ?? [])
    .map((s) => s.trim().slice(0, 400))
    .filter(Boolean)
    .slice(0, 8);
  const toolBlock = (input.toolContextBlock ?? "").trim();
  let heuristic = buildHeuristicIntent(input.script, excerpts);
  let intentSource: ClipEngineBundle["intent_source"] = "heuristic";

  const openaiIntent = await refineIntentWithOpenAI(input.script, heuristic);
  if (openaiIntent) {
    heuristic = openaiIntent;
    intentSource = "heuristic+openai";
  }

  const rolling =
    excerpts.length > 0
      ? `Recent user prompts (newest first): ${excerpts.slice(0, 5).join(" · ").slice(0, 500)}`
      : "";

  const plannerBlock = assemblePlannerContextBlock(
    input.script,
    heuristic,
    rolling,
    retrieved,
    toolBlock,
  );
  const hook = hookStyleFromIntent(heuristic, input.script);
  const evaluated = evaluateClipTurn(input.script, heuristic);

  if (!evaluated.pass) {
    intentSource = "fallback";
  }

  return {
    version: 1,
    intent: heuristic,
    rolling_summary: rolling,
    planner_context_block: plannerBlock,
    hook_style_resolved: hook,
    evaluated,
    intent_source: intentSource,
    ...(retrieved.length > 0 ? { retrieved_memories: retrieved } : {}),
    ...(toolBlock.length > 0 ? { tool_context_block: toolBlock } : {}),
  };
}
