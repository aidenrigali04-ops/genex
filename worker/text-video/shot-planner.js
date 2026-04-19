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
 * @typedef {{ hookStyle?: string | null }} PlanShotsOptions
 */

/**
 * Given a script, returns a shot list:
 * [{ keyword: string, duration: number, caption: string }]
 * @param {string} script
 * @param {PlanShotsOptions} [options]
 */
export async function planShots(script, options = {}) {
  const hookStyle = options.hookStyle?.trim() || null;
  const openai = getOpenAI();
  const systemPrompt = `You are a short-form video director for TikTok/Reels (9:16 vertical).
Given a script, output a JSON object with a single key "shots" whose value is an array of shots.
Each shot:
  - "keyword": 2-4 word search query for Pexels stock footage (be specific and visual)
  - "duration": seconds this shot plays (integer 3–8)
  - "caption": exact words spoken during this shot (≤12 words, from the script)

Rules:
- Total duration MUST be between 30 and 60 seconds (sum of duration fields)
- Keywords must be visual and searchable (e.g. "creator talking selfie ring light" not "motivation")
- Captions should match what the voiceover says during each shot
- FIRST shot MUST be high-energy: include a person, face, or clear human action (e.g. creator, reaction, talking to camera, workout, handshake). Never choose wide landscape-only or scenery-without-people for shot 1.
- Avoid as standalone keywords: "nature", "sky", "generic background", or empty scenic-only phrases with no human.
- Prefer: people, concrete action, urban, tech, business, workplace, fitness, and emotion-specific clips.
- If the script clearly mentions people (I, you, we, someone, people, audience, customers, team, etc.), EVERY shot keyword must include an explicit human element (who is on screen).
- Output ONLY valid JSON: {"shots":[...]} with no other keys or prose

Example:
{"shots":[
  { "keyword": "creator excited talking camera vertical", "duration": 4, "caption": "Most people scroll. Winners study." },
  { "keyword": "startup team high five office", "duration": 5, "caption": "Every morning is a new opportunity to win." }
]}`;

  const userContent = `Platform: TikTok/Reels (9:16 vertical)
Style: high-energy short-form
Hook style: ${hookStyle ?? "viral"}

Script:
${script.slice(0, 4000)}`;

  let retries = 3;
  let lastErr;
  while (retries > 0) {
    try {
      const res = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      });

      const raw = res.choices[0]?.message?.content ?? "";
      const parsed = JSON.parse(raw);
      const shots = Array.isArray(parsed) ? parsed : parsed.shots ?? [];

      if (!Array.isArray(shots) || shots.length < 3) {
        throw new Error("Shot plan too short");
      }

      const totalDuration = shots.reduce(
        (s, sh) => s + (Number(sh.duration) || 5),
        0,
      );
      if (totalDuration < 20) throw new Error("Total duration too short");

      return shots.map((sh) => ({
        keyword: String(
          sh.keyword ?? "person talking smartphone vertical energetic",
        ),
        duration: Math.min(8, Math.max(3, Math.round(Number(sh.duration) || 5))),
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
