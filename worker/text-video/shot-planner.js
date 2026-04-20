import OpenAI from "openai";

/** Lazy client: worker static imports run before `dotenv.config()`; read env on first use. */
let openaiCached;
function getOpenAI() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "Missing OPENAI_API_KEY. Set in worker/.env, repo root .env.local, or host env (Railway).",
    );
  }
  if (!openaiCached) {
    openaiCached = new OpenAI({ apiKey: key });
  }
  return openaiCached;
}

/**
 * @typedef {{
 *   hookStyle?: string | null,
 *   clipEngineContext?: string | null,
 *   onCheckpoint?: (phase: string, payload?: Record<string, unknown>) => void | Promise<void>,
 *   supabase?: import("@supabase/supabase-js").SupabaseClient | null,
 *   jobId?: string | null,
 * }} PlanShotsOptions
 */

async function mergeCheckpoint(supabase, jobId, phase, payload = {}) {
  if (!supabase || !jobId) return;
  try {
    const { data } = await supabase
      .from("text_video_jobs")
      .select("clip_engine")
      .eq("id", jobId)
      .maybeSingle();
    const base =
      data?.clip_engine && typeof data.clip_engine === "object" ? data.clip_engine : {};
    const next = {
      ...base,
      checkpoint: {
        phase,
        updated_at: new Date().toISOString(),
        ...payload,
      },
    };
    await supabase.from("text_video_jobs").update({ clip_engine: next }).eq("id", jobId);
  } catch (e) {
    console.warn("[shot-planner] checkpoint merge failed", e);
  }
}

/** After parsing shots, deduplicate overlapping keyword roots (first token). */
function deduplicateKeywords(shots) {
  const usedRoots = new Set();
  const variants = [
    "close up",
    "outdoor",
    "indoor",
    "morning",
    "urban",
    "aerial",
    "slow motion",
  ];
  return shots.map((shot, idx) => {
    const root = String(shot.keyword ?? "")
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase();
    if (!root) return shot;
    if (usedRoots.has(root)) {
      const variant = variants[idx % variants.length];
      return {
        ...shot,
        keyword: `${String(shot.keyword).trim()} ${variant}`,
      };
    }
    usedRoots.add(root);
    return shot;
  });
}

/**
 * Ensure opener/closer shots read as human-forward for hook + resolution frames.
 * @param {Array<{ keyword?: string; duration?: number; caption?: string }>} shots
 */
function enforceVisualArc(shots) {
  if (!Array.isArray(shots) || shots.length < 3) return shots;

  const openerHints = [
    "close up person",
    "face",
    "hands",
    "reaction",
    "portrait",
  ];
  const firstKw = String(shots[0]?.keyword ?? "").toLowerCase();
  const firstHasHuman = openerHints.some((kw) => firstKw.includes(kw));

  let out = shots;
  if (!firstHasHuman) {
    const topic = String(shots[0]?.keyword ?? "")
      .trim()
      .split(/\s+/)
      .slice(-2)
      .join(" ");
    out = [
      {
        ...shots[0],
        keyword: `close up person ${topic || "speaking"} natural light`.trim(),
      },
      ...shots.slice(1),
    ];
  }

  const lastIdx = out.length - 1;
  const lastKw = String(out[lastIdx]?.keyword ?? "").toLowerCase();
  const closerHints = ["person", "man", "woman", "face", "people"];
  const lastHasHuman = closerHints.some((kw) => lastKw.includes(kw));

  if (!lastHasHuman) {
    out = out.slice();
    out[lastIdx] = {
      ...out[lastIdx],
      keyword: `${String(out[lastIdx]?.keyword ?? "").trim()} person reaction`.trim(),
    };
  }

  return out;
}

/**
 * Primary director pass — JSON shot list.
 * @param {string} script
 * @param {PlanShotsOptions} [options]
 */
export async function planShotsOnce(script, options = {}) {
  const hookStyle = options.hookStyle?.trim() || null;
  const clipEngineContext = options.clipEngineContext?.trim() || null;
  const openai = getOpenAI();
  const systemPrompt = `You are a professional short-form video director with 
10 years of TikTok and Reels editing experience.

Given a script, output a JSON object: { "shots": [...] }
Each shot has exactly three fields:
  - "keyword": a 3-6 word Pexels search query (see keyword rules below)
  - "duration": integer seconds this shot plays (3–7 only)
  - "caption": the exact words spoken during this shot (≤10 words, verbatim from script)

KEYWORD RULES (critical for visual quality):
1. Always include a SUBJECT + ACTION + SETTING
   Good: "woman typing laptop coffee shop", "man running city street night"
   Bad: "success", "motivation", "concept", "idea", "growth"
2. First shot MUST feature a person in motion or reaction — never a landscape
3. Alternate between: close-up person shots AND wider environment/action shots
4. For abstract concepts, use a concrete visual metaphor:
   "financial freedom" → "person holding cash walking street"
   "mental health" → "woman meditating sunrise park"
   "productivity" → "focused man desk organized workspace"
5. Never repeat the same keyword root across shots
6. Avoid: "background", "generic", "abstract", "concept art", "illustration"

TIMING RULES:
- Total duration MUST be 28–55 seconds (sum of all duration fields)
- Shorter shots (3–4s) for punchy hook lines
- Longer shots (5–7s) for explanation or emotional beats
- Minimum 6 shots, maximum 12 shots

VISUAL ARC RULES (critical for professional feel):
- Shot 1 (OPENER): Must feature a PERSON in close-up or medium shot — face, hands,
  or reaction. This is the hook frame. Never a landscape or object-only shot.
  Keywords must include one of: "close up person", "face reaction", or "hands working"
- Shots 2–4 (BUILD): Alternate between WIDE environment shots and CLOSE detail shots.
  Wide: shows the world/context (e.g. "busy city street morning rush")
  Detail: shows the specific action (e.g. "typing laptop coffee shop focused")
- Shot N–1 (PRE-CLOSE): An emotional or conceptual beat — a person reacting to an
  outcome, nature metaphor, or symbolic action.
- Shot N (CLOSER): Return to a person in medium shot — ending on a human face or
  gesture creates psychological closure. Never end on an object or location only.

KEYWORD QUALITY MULTIPLIERS (dramatically improve Pexels results):
- Add a lighting/time descriptor: "golden hour", "natural light", or "bright studio"
- Add a motion descriptor: "walking", "working", "running", "laughing", or "talking"
- Add an emotional tone: "focused", "confident", "relaxed", or "energetic"
- Bad: "fitness motivation"
- Good: "woman running track sunrise motivated energetic"
- Bad: "success business"
- Good: "confident man suit office window natural light"

CAPTION RULES:
- Captions are what the voiceover says DURING that shot — slice the script naturally
- Each caption should be a complete thought or phrase, not mid-sentence
- If a shot is transitional (no speech), set caption to ""

Output ONLY valid JSON: {"shots":[...]} — no prose, no markdown, no code blocks.`;

  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const estimatedDuration = Math.round(wordCount / 2.5); // ~150 wpm
  const userMessage = `${clipEngineContext ? `${clipEngineContext}\n\n` : ""}Hook style: ${hookStyle ?? "viral"}

Estimated spoken duration: ~${estimatedDuration}s
Word count: ${wordCount}

Script:
${script.slice(0, 4000)}`;

  let retries = 3;
  let lastErr;
  while (retries > 0) {
    try {
      const res = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
      });

      const raw = res.choices[0]?.message?.content ?? "";
      const parsed = JSON.parse(raw);
      const rawShots = Array.isArray(parsed) ? parsed : parsed.shots ?? [];

      if (!Array.isArray(rawShots) || rawShots.length < 6) {
        throw new Error("Shot plan too short (need at least 6 shots)");
      }

      let shots = enforceVisualArc(deduplicateKeywords(rawShots)).slice(0, 12);

      let totalDuration = shots.reduce(
        (s, sh) => s + (Number(sh.duration) || 5),
        0,
      );
      if (totalDuration < 28) {
        throw new Error("Total duration too short (need 28–55s)");
      }
      if (totalDuration > 55) {
        const factor = 55 / totalDuration;
        shots = shots.map((sh) => ({
          ...sh,
          duration: Math.max(
            3,
            Math.min(7, Math.round((Number(sh.duration) || 5) * factor)),
          ),
        }));
        totalDuration = shots.reduce(
          (s, sh) => s + (Number(sh.duration) || 0),
          0,
        );
      }

      return shots.map((sh) => ({
        keyword: String(
          sh.keyword ?? "person talking smartphone vertical energetic",
        ),
        duration: Math.min(7, Math.max(3, Math.round(Number(sh.duration) || 5))),
        caption: String(sh.caption ?? "").slice(0, 200),
      }));
    } catch (e) {
      lastErr = e;
      retries--;
      if (retries === 0) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr ?? new Error("planShots failed");
}

/**
 * Stream tokens from a critique model, then parse trailing JSON object.
 * @param {import("openai").OpenAI} openai
 */
async function streamSelfCritiqueJson(openai, system, user) {
  const model =
    process.env.OPENAI_SHOT_CRITIQUE_MODEL?.trim() || "gpt-4o-mini";
  const stream = await openai.chat.completions.create({
    model,
    temperature: 0.15,
    max_tokens: 1200,
    stream: true,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  let buf = "";
  for await (const part of stream) {
    buf += part.choices[0]?.delta?.content ?? "";
  }
  const start = buf.lastIndexOf("{");
  const end = buf.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("critique_stream_no_json");
  }
  return JSON.parse(buf.slice(start, end + 1));
}

function applyShotPatches(shots, patches) {
  if (!Array.isArray(patches) || patches.length === 0) return shots;
  const out = shots.map((s) => ({ ...s }));
  for (const p of patches) {
    const i = Number(p.shot_index);
    if (!Number.isInteger(i) || i < 0 || i >= out.length) continue;
    if (typeof p.keyword === "string" && p.keyword.trim())
      out[i] = { ...out[i], keyword: p.keyword.trim().slice(0, 200) };
    if (typeof p.caption === "string")
      out[i] = { ...out[i], caption: p.caption.slice(0, 200) };
    if (p.duration != null) {
      const d = Math.round(Number(p.duration));
      if (d >= 2 && d <= 8) out[i] = { ...out[i], duration: d };
    }
  }
  return out;
}

/**
 * Multi-agent: streaming self-critique → patches, then adversarial reviewer (JSON).
 * @param {string} script
 * @param {Array<{ keyword: string; duration: number; caption: string }>} shots
 * @param {PlanShotsOptions} options
 */
async function runReviewLoop(script, shots, options) {
  const openai = getOpenAI();
  const maxPasses = Math.min(
    6,
    Math.max(1, Number(process.env.OPENAI_SHOT_REVIEW_MAX_PASSES || 2) || 2),
  );
  let current = shots;
  const cp = options.onCheckpoint;
  const sb = options.supabase ?? null;
  const jid = options.jobId ?? null;

  for (let pass = 0; pass < maxPasses; pass++) {
    await mergeCheckpoint(sb, jid, `critique_stream_start`, { pass });
    if (cp) await cp("critique_stream_start", { pass });

    const critiqueSystem = `You are a strict shot-list editor for vertical short-form video.
Return JSON ONLY: { "score": 0-10, "patches": [ { "shot_index": number, "keyword"?: string, "caption"?: string, "duration"?: number } ], "notes": string[] }
Rules:
- score how well keywords obey Pexels-friendly concrete visuals + arc rules from the user script.
- patches: minimal fixes; empty array if score >= 8.
- Never remove shots; only patch fields.`;

    const critiqueUser = `Script:\n${script.slice(0, 3500)}\n\nShots JSON:\n${JSON.stringify({ shots: current })}`;

    let crit;
    try {
      crit = await streamSelfCritiqueJson(openai, critiqueSystem, critiqueUser);
    } catch {
      break;
    }

    await mergeCheckpoint(sb, jid, `critique_stream_done`, {
      pass,
      score: crit.score,
    });
    if (cp) await cp("critique_stream_done", { pass, score: crit.score });

    const score = Number(crit.score);
    const patches = Array.isArray(crit.patches) ? crit.patches : [];
    if (Number.isFinite(score) && score >= 8 && patches.length === 0) break;
    if (patches.length > 0) {
      current = enforceVisualArc(deduplicateKeywords(applyShotPatches(current, patches)));
    }

    const reviewSystem = `You are an adversarial QA reviewer. Return JSON ONLY:
{ "approve": boolean, "issues": string[] }
Approve only if shot list is coherent, arc-safe, and timings sum 28–55s.`;

    const total = current.reduce((s, sh) => s + (Number(sh.duration) || 0), 0);
    const reviewUser = `Total duration ~${total}s. Shots:\n${JSON.stringify({ shots: current })}`;

    let rev;
    try {
      const res = await openai.chat.completions.create({
        model: process.env.OPENAI_SHOT_ADVERSARIAL_MODEL?.trim() || "gpt-4o-mini",
        temperature: 0,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: reviewSystem },
          { role: "user", content: reviewUser },
        ],
      });
      rev = JSON.parse(res.choices[0]?.message?.content ?? "{}");
    } catch {
      break;
    }

    await mergeCheckpoint(sb, jid, `adversarial_review`, {
      pass,
      approve: !!rev.approve,
    });
    if (cp) await cp("adversarial_review", { pass, approve: !!rev.approve });

    if (rev.approve) break;
  }

  return current;
}

/**
 * Director + streaming critique + adversarial review (in-process reconnect via clip_engine.checkpoint).
 * @param {string} script
 * @param {PlanShotsOptions} [options]
 */
export async function planShots(script, options = {}) {
  const skipReview =
    process.env.SKIP_SHOT_REVIEW === "1" ||
    process.env.SKIP_SHOT_REVIEW?.toLowerCase() === "true";

  await mergeCheckpoint(
    options.supabase ?? null,
    options.jobId ?? null,
    "planning_draft_start",
    {},
  );
  if (options.onCheckpoint) await options.onCheckpoint("planning_draft_start", {});

  const draft = await planShotsOnce(script, options);

  await mergeCheckpoint(
    options.supabase ?? null,
    options.jobId ?? null,
    "planning_draft_done",
    { shot_count: draft.length },
  );
  if (options.onCheckpoint)
    await options.onCheckpoint("planning_draft_done", { shot_count: draft.length });

  const reviewed = skipReview
    ? draft
    : await runReviewLoop(script, draft, options);

  await mergeCheckpoint(
    options.supabase ?? null,
    options.jobId ?? null,
    "planning_final",
    { shot_count: reviewed.length },
  );
  if (options.onCheckpoint)
    await options.onCheckpoint("planning_final", { shot_count: reviewed.length });

  let out = reviewed.map((sh) => ({
    keyword: String(
      sh.keyword ?? "person talking smartphone vertical energetic",
    ),
    duration: Math.min(7, Math.max(3, Math.round(Number(sh.duration) || 5))),
    caption: String(sh.caption ?? "").slice(0, 200),
  }));
  let totalDuration = out.reduce((s, sh) => s + sh.duration, 0);
  if (totalDuration > 55) {
    const factor = 55 / totalDuration;
    out = out.map((sh) => ({
      ...sh,
      duration: Math.max(
        3,
        Math.min(7, Math.round(sh.duration * factor)),
      ),
    }));
    totalDuration = out.reduce((s, sh) => s + sh.duration, 0);
  }
  return out;
}
