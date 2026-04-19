import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Given a script, returns a shot list:
 * [{ keyword: string, duration: number, caption: string }]
 */
export async function planShots(script) {
  const systemPrompt = `You are a short-form video director.
Given a TikTok/Reels script, output a JSON object with a single key "shots" whose value is an array of shots.
Each shot:
  - "keyword": 2-4 word search query for Pexels stock footage (be specific and visual)
  - "duration": seconds this shot plays (integer 3–8)
  - "caption": exact words spoken during this shot (≤12 words, from the script)

Rules:
- Total duration MUST be between 30 and 60 seconds (sum of duration fields)
- Keywords must be visual and searchable (e.g. "person running beach sunset" not "motivation")
- Captions should match what the voiceover says during each shot
- Output ONLY valid JSON: {"shots":[...]} with no other keys or prose

Example:
{"shots":[
  { "keyword": "entrepreneur typing laptop coffee shop", "duration": 4, "caption": "Most people scroll. Winners study." },
  { "keyword": "sunrise city timelapse", "duration": 5, "caption": "Every morning is a new opportunity to win." }
]}`;

  let retries = 3;
  let lastErr;
  while (retries > 0) {
    try {
      const res = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Script:\n${script.slice(0, 4000)}` },
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
        keyword: String(sh.keyword ?? "nature landscape"),
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
