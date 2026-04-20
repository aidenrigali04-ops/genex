/**
 * Video clipping pipeline helpers (GenEx worker).
 * Prompt tightening, FFmpeg scene/silence signals, Whisper word boundaries,
 * and deterministic segment refinement — no UI; aligns with worker.js flow.
 */

import { spawn } from "node:child_process";

const DURATION_HARD_MIN = 15;
const DURATION_HARD_MAX = 90;
const DEFAULT_CLIP_MIN = 21;
const DEFAULT_CLIP_MAX = 60;
const SNAP_WINDOW_SEC = 2.25;
const MIN_SEGMENT_LEN = 0.35;

/** @param {unknown} jobId */
function slog(jobId, msg) {
  console.log(`[${jobId}] [clip-pipeline] ${msg}`);
}

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 */
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * @param {string} prompt
 * @param {number} durationSec
 */
export function heuristicTightenedIntent(prompt, durationSec) {
  const p = (prompt || "").toLowerCase();
  let dmin = DEFAULT_CLIP_MIN;
  let dmax = DEFAULT_CLIP_MAX;

  const range = /\b(\d{1,2})\s*[-–]\s*(\d{1,3})\s*(?:s(?:ec(?:onds)?)?)\b/i.exec(prompt);
  if (range) {
    dmin = clamp(parseInt(range[1], 10), DURATION_HARD_MIN, DURATION_HARD_MAX - 1);
    dmax = clamp(parseInt(range[2], 10), dmin + 1, DURATION_HARD_MAX);
  } else {
    const single = /\b(?:~|about|around)?\s*(\d{1,2})\s*(?:s(?:ec(?:onds)?)?)\b/i.exec(prompt);
    if (single) {
      const v = clamp(parseInt(single[1], 10), DURATION_HARD_MIN, DURATION_HARD_MAX);
      dmin = clamp(v - 8, DURATION_HARD_MIN, v - 1);
      dmax = clamp(v + 12, v + 1, DURATION_HARD_MAX);
    }
  }

  const cap = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 600;
  dmax = Math.min(dmax, cap + 0.5, DURATION_HARD_MAX);
  dmin = Math.min(dmin, dmax - 1);

  let tone = "mixed";
  if (/\b(funny|comedy|humor|joke)\b/.test(p)) tone = "funny";
  else if (/\b(educat|teach|tutorial|explain|learn)\b/.test(p)) tone = "educational";
  else if (/\b(calm|gentle|soft|meditative)\b/.test(p)) tone = "calm";
  else if (/\b(hype|energy|viral|fire|insane)\b/.test(p)) tone = "hype";

  let platform = "generic";
  if (/\btiktok\b/.test(p)) platform = "tiktok";
  else if (/\b(reels|instagram)\b/.test(p)) platform = "reels";
  else if (/\b(shorts|youtube short)\b/.test(p)) platform = "shorts";

  const lang = /\b(spanish|español|french|arabic|german|portuguese|hindi)\b/i.test(p)
    ? "non_en_preferred"
    : "en";

  const mustKw = [];
  for (const m of prompt.matchAll(/"([^"]{2,80})"/g)) {
    mustKw.push(m[1].trim());
    if (mustKw.length >= 8) break;
  }

  /** @type {const} */
  const base = {
    version: 1,
    clip_count_requested: 5,
    duration_seconds_min: dmin,
    duration_seconds_max: dmax,
    aspect_ratio: "9:16",
    tone,
    target_platform: platform,
    language: lang,
    must_include_keywords: mustKw,
    named_speakers: [],
    scoring_weights_hint:
      "Prioritize hooks in first 3s, complete thought units, emotional peaks, and endings that land a punch or CTA.",
    intent_expansion:
      "Short-form edit: strong cold open, retain narrative coherence, avoid mid-sentence cuts at in/out; prefer 21–34s total when the source supports it for retention.",
    caption_style: /\b(minimal|clean|subtitles?)\b/i.test(p) ? "minimal" : "kinetic",
    confidence: 0.35,
    source: "heuristic",
  };
  return base;
}

/**
 * Schema-constrained intent + rubric (JSON) for downstream planning.
 * @param {import("openai").default} openai
 * @param {unknown} jobId
 * @param {string} prompt
 * @param {number} durationSec
 */
export async function tightenClipIntentWithOpenAI(openai, jobId, prompt, durationSec) {
  const fallback = () => heuristicTightenedIntent(prompt, durationSec);
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return fallback();

  const model = process.env.OPENAI_CLIP_TIGHTEN_MODEL?.trim() || "gpt-4o-mini";
  const system = `You normalize user intent for a SOURCE-VIDEO clipping pipeline (real edits from timestamps, not generative B-roll).
The user's raw_prompt is authoritative: extract literal must-haves (topics to include/avoid, speakers, pacing, platform) before inferring extras.
Return ONLY JSON with keys:
version (always 1),
clip_count_requested (integer 3-8, default 5),
duration_seconds_min (15-88),
duration_seconds_max (16-90, must exceed min),
aspect_ratio ("9:16"|"1:1"|"16:9"),
tone ("funny"|"educational"|"hype"|"calm"|"mixed"),
target_platform ("tiktok"|"reels"|"shorts"|"yt_shorts"|"generic"),
language (ISO-ish string or "mixed"),
must_include_keywords (string[], max 12 short items),
named_speakers (string[], max 6),
scoring_weights_hint (string, one paragraph: what to emphasize when picking moments),
intent_expansion (string, explicit rubric: hooks in first 3s, complete thoughts, emotional peaks, max dead air),
caption_style ("kinetic"|"minimal"|"subtitle"),
confidence (number 0-1).

Guardrails:
- If the user contradicts (e.g. "90s" and "15s max"), prefer 15-90 shorts window and note in intent_expansion.
- Default duration_seconds_min/max to 21 and 60 when unspecified for TikTok/Reels-style requests.
- video_duration_sec is provided; never ask for clip totals longer than the source.`;

  const user = JSON.stringify({
    raw_prompt: (prompt || "").slice(0, 8000),
    video_duration_sec: durationSec,
  });

  try {
    const res = await openai.chat.completions.create({
      model,
      temperature: 0.15,
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const raw = res.choices[0]?.message?.content;
    if (!raw) return fallback();
    const j = JSON.parse(raw);
    const dmin = clamp(
      Number(j.duration_seconds_min) || DEFAULT_CLIP_MIN,
      DURATION_HARD_MIN,
      DURATION_HARD_MAX - 1,
    );
    let dmax = clamp(
      Number(j.duration_seconds_max) || DEFAULT_CLIP_MAX,
      dmin + 1,
      DURATION_HARD_MAX,
    );
    dmax = Math.min(dmax, durationSec + 0.5);
    const out = {
      version: 1,
      clip_count_requested: clamp(Math.round(Number(j.clip_count_requested) || 5), 3, 8),
      duration_seconds_min: dmin,
      duration_seconds_max: dmax,
      aspect_ratio: ["9:16", "1:1", "16:9"].includes(j.aspect_ratio) ? j.aspect_ratio : "9:16",
      tone: ["funny", "educational", "hype", "calm", "mixed"].includes(j.tone) ? j.tone : "mixed",
      target_platform: ["tiktok", "reels", "shorts", "yt_shorts", "generic"].includes(
        j.target_platform,
      )
        ? j.target_platform
        : "generic",
      language: typeof j.language === "string" && j.language.trim() ? j.language.trim() : "en",
      must_include_keywords: Array.isArray(j.must_include_keywords)
        ? j.must_include_keywords.map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
        : [],
      named_speakers: Array.isArray(j.named_speakers)
        ? j.named_speakers.map((x) => String(x).trim()).filter(Boolean).slice(0, 6)
        : [],
      scoring_weights_hint: String(j.scoring_weights_hint || "").slice(0, 1200) || fallback().scoring_weights_hint,
      intent_expansion: String(j.intent_expansion || "").slice(0, 1600) || fallback().intent_expansion,
      caption_style: ["kinetic", "minimal", "subtitle"].includes(j.caption_style)
        ? j.caption_style
        : "kinetic",
      confidence: clamp(Number(j.confidence) || 0.5, 0, 1),
      source: "openai",
    };
    slog(jobId, `Intent tightened (${model}, confidence=${out.confidence.toFixed(2)})`);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    slog(jobId, `Intent tighten failed (${msg}) — heuristic fallback`);
    const h = fallback();
    return { ...h, source: "heuristic+fallback" };
  }
}

/**
 * Parse FFmpeg showinfo stderr for scene-like cuts.
 * @param {unknown} jobId
 * @param {string} videoPath
 * @param {number} durationSec
 */
export function detectSceneCutsFfmpeg(jobId, videoPath, durationSec) {
  return new Promise((resolve) => {
    const args = [
      "-hide_banner",
      "-nostats",
      "-i",
      videoPath,
      "-vf",
      "select='gt(scene,0.38)',showinfo",
      "-vsync",
      "vfr",
      "-f",
      "null",
      "-",
    ];
    const child = spawn("ffmpeg", args, { env: process.env });
    let err = "";
    child.stderr?.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", () => {
      const times = new Set();
      const re = /pts_time:([\d.]+)/g;
      let m;
      while ((m = re.exec(err)) !== null) {
        const t = parseFloat(m[1], 10);
        if (Number.isFinite(t) && t >= 0 && t <= durationSec + 0.01) {
          times.add(Math.round(t * 1000) / 1000);
        }
      }
      const arr = [...times].sort((a, b) => a - b);
      slog(jobId, `Scene-cut candidates: ${arr.length}`);
      resolve(arr);
    });
    child.on("error", () => resolve([]));
  });
}

/**
 * Scene detection on a downscaled video chain (same timeline as source; cheaper decode on Railway).
 * @param {unknown} jobId
 * @param {string} videoPath
 * @param {number} durationSec
 */
export function detectSceneCutsFfmpegScaled(jobId, videoPath, durationSec) {
  const w = Number(process.env.GENEX_SCENE_PROXY_WIDTH) || 400;
  const thr = process.env.GENEX_SCENE_PROXY_THRESHOLD || "0.38";
  return new Promise((resolve) => {
    const vf = `scale=-2:${w},select='gt(scene,${thr})',showinfo`;
    const args = [
      "-hide_banner",
      "-nostats",
      "-i",
      videoPath,
      "-vf",
      vf,
      "-vsync",
      "vfr",
      "-f",
      "null",
      "-",
    ];
    const child = spawn("ffmpeg", args, { env: process.env });
    let err = "";
    child.stderr?.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", () => {
      const times = new Set();
      const re = /pts_time:([\d.]+)/g;
      let m;
      while ((m = re.exec(err)) !== null) {
        const t = parseFloat(m[1], 10);
        if (Number.isFinite(t) && t >= 0 && t <= durationSec + 0.01) {
          times.add(Math.round(t * 1000) / 1000);
        }
      }
      const arr = [...times].sort((a, b) => a - b);
      slog(jobId, `Scene-cut candidates (proxy ${w}px): ${arr.length}`);
      resolve(arr);
    });
    child.on("error", () => resolve([]));
  });
}

/**
 * Extract mono 16k PCM for silencedetect (avoids full-video demux cost vs video+audio graph).
 * @param {unknown} jobId
 * @param {string} videoPath
 * @param {string} outWavPath
 */
export function extractMonoWav16kForSilence(jobId, videoPath, outWavPath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i",
      videoPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      outWavPath,
    ];
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"], env: process.env });
    let err = "";
    child.stderr?.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", (code) => {
      if (code === 0) {
        slog(jobId, "Silence probe WAV extracted");
        resolve();
      } else reject(new Error(`ffmpeg wav extract: ${err.slice(-400)}`));
    });
    child.on("error", reject);
  });
}

/**
 * Silencedetect on a WAV file (from {@link extractMonoWav16kForSilence}).
 * @param {unknown} jobId
 * @param {string} wavPath
 */
export function detectSilenceMidpointsFromWav(jobId, wavPath) {
  return new Promise((resolve) => {
    const thr = process.env.GENEX_SILENCEDETECT_NOISE ?? "-40";
    const dur = process.env.GENEX_SILENCEDETECT_MIN ?? "0.32";
    const args = [
      "-hide_banner",
      "-nostats",
      "-i",
      wavPath,
      "-af",
      `silencedetect=noise=${thr}dB:d=${dur}`,
      "-f",
      "null",
      "-",
    ];
    const child = spawn("ffmpeg", args, { env: process.env });
    let err = "";
    child.stderr?.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", () => {
      const mids = [];
      let curStart = null;
      for (const line of err.split("\n")) {
        const ss = /silence_start:\s*([\d.]+)/.exec(line);
        const se = /silence_end:\s*([\d.]+)/.exec(line);
        if (ss) curStart = parseFloat(ss[1], 10);
        if (se && curStart != null) {
          const end = parseFloat(se[1], 10);
          if (Number.isFinite(curStart) && Number.isFinite(end) && end > curStart) {
            mids.push((curStart + end) / 2);
          }
          curStart = null;
        }
      }
      const uniq = [...new Set(mids.filter((t) => Number.isFinite(t)))].sort((a, b) => a - b);
      slog(jobId, `Silence midpoints (wav): ${uniq.length}`);
      resolve(uniq);
    });
    child.on("error", () => resolve([]));
  });
}

/**
 * Parse silencedetect stderr; return silence midpoints as soft cut hints.
 * @param {unknown} jobId
 * @param {string} videoPath
 */
export function detectSilenceMidpointsFfmpeg(jobId, videoPath) {
  return new Promise((resolve) => {
    const thr = process.env.GENEX_SILENCEDETECT_NOISE ?? "-40";
    const dur = process.env.GENEX_SILENCEDETECT_MIN ?? "0.32";
    const args = [
      "-hide_banner",
      "-nostats",
      "-i",
      videoPath,
      "-af",
      `silencedetect=noise=${thr}dB:d=${dur}`,
      "-f",
      "null",
      "-",
    ];
    const child = spawn("ffmpeg", args, { env: process.env });
    let err = "";
    child.stderr?.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", () => {
      const mids = [];
      let curStart = null;
      for (const line of err.split("\n")) {
        const ss = /silence_start:\s*([\d.]+)/.exec(line);
        const se = /silence_end:\s*([\d.]+)/.exec(line);
        if (ss) curStart = parseFloat(ss[1], 10);
        if (se && curStart != null) {
          const end = parseFloat(se[1], 10);
          if (Number.isFinite(curStart) && Number.isFinite(end) && end > curStart) {
            mids.push((curStart + end) / 2);
          }
          curStart = null;
        }
      }
      const uniq = [...new Set(mids.filter((t) => Number.isFinite(t)))].sort((a, b) => a - b);
      slog(jobId, `Silence midpoints: ${uniq.length}`);
      resolve(uniq);
    });
    child.on("error", () => resolve([]));
  });
}

/**
 * @param {unknown} transcription
 * @returns {{ start: number, end: number, word: string }[]}
 */
export function normalizeWhisperWords(transcription) {
  const raw = Array.isArray(transcription?.words) ? transcription.words : [];
  const out = [];
  for (const w of raw) {
    const start = typeof w.start === "number" ? w.start : parseFloat(String(w.start), 10);
    const end = typeof w.end === "number" ? w.end : parseFloat(String(w.end), 10);
    const word = String(w.word || "").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    out.push({ start, end, word });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * @param {{ start: number, end: number, word: string }[]} words
 * @param {number} durationSec
 * @param {number} maxPoints
 */
export function sampleWordBoundaryTimes(words, durationSec, maxPoints = 420) {
  const set = new Set();
  for (const w of words) {
    set.add(Math.round(clamp(w.start, 0, durationSec) * 1000) / 1000);
    set.add(Math.round(clamp(w.end, 0, durationSec) * 1000) / 1000);
  }
  const arr = [...set].sort((a, b) => a - b);
  if (arr.length <= maxPoints) return arr;
  const stride = Math.ceil(arr.length / maxPoints);
  const out = [];
  for (let i = 0; i < arr.length; i += stride) out.push(arr[i]);
  const last = arr[arr.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * If t lands inside a word, move to boundary (start for 'start', end for 'end').
 * @param {number} t
 * @param {'start' | 'end'} kind
 * @param {{ start: number, end: number, word: string }[]} words
 */
export function alignToWordBoundary(t, kind, words) {
  let x = t;
  for (const w of words) {
    if (x > w.start && x < w.end) {
      x = kind === "start" ? w.start : w.end;
      break;
    }
  }
  return x;
}

/**
 * Nearest signal within window (prefer earlier for starts, later for ends when equidistant — weak tie-break).
 * @param {number} t
 * @param {number[]} candidates sorted unique
 * @param {'start' | 'end'} kind
 */
export function snapToNearestSignal(t, candidates, kind) {
  if (!candidates.length) return t;
  let best = t;
  let bestD = SNAP_WINDOW_SEC + 1;
  for (const c of candidates) {
    const d = Math.abs(c - t);
    if (d > SNAP_WINDOW_SEC) continue;
    if (d < bestD - 1e-4) {
      best = c;
      bestD = d;
    } else if (Math.abs(d - bestD) <= 1e-4) {
      if (kind === "start" && c < best) best = c;
      if (kind === "end" && c > best) best = c;
    }
  }
  return best;
}

/**
 * Merge scene cuts + silence mids + word boundaries for snapping.
 * @param {number[]} sceneCuts
 * @param {number[]} silenceMids
 * @param {{ start: number, end: number, word: string }[]} words
 * @param {number} durationSec
 */
export function buildSnapCandidates(sceneCuts, silenceMids, words, durationSec) {
  const set = new Set([0, Math.max(0, durationSec)]);
  for (const x of sceneCuts) set.add(Math.round(clamp(x, 0, durationSec) * 1000) / 1000);
  for (const x of silenceMids) set.add(Math.round(clamp(x, 0, durationSec) * 1000) / 1000);
  for (const w of words) {
    set.add(Math.round(clamp(w.start, 0, durationSec) * 1000) / 1000);
    set.add(Math.round(clamp(w.end, 0, durationSec) * 1000) / 1000);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Refine one variation's segments: word integrity + snap + clamp + min length.
 * @param {{ start: number, end: number }[]} segments
 * @param {number[]} snapCandidates sorted
 * @param {{ start: number, end: number, word: string }[]} words
 * @param {number} durationSec
 * @param {{ minTotal: number, maxTotal: number }} bounds from planner
 */
export function postRefineVariationSegments(segments, snapCandidates, words, durationSec, bounds) {
  const d = Number(durationSec);
  const out = [];
  for (const seg of segments) {
    let s = Number(seg.start);
    let e = Number(seg.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    s = clamp(s, 0, d);
    e = clamp(e, 0, d);
    s = alignToWordBoundary(s, "start", words);
    e = alignToWordBoundary(e, "end", words);
    s = snapToNearestSignal(s, snapCandidates, "start");
    e = snapToNearestSignal(e, snapCandidates, "end");
    s = clamp(s, 0, d);
    e = clamp(e, 0, d);
    if (e - s < MIN_SEGMENT_LEN) {
      e = clamp(s + MIN_SEGMENT_LEN, 0, d);
    }
    if (e > s) out.push({ start: s, end: e });
  }
  if (out.length === 0) return segments;

  let total = out.reduce((acc, x) => acc + (x.end - x.start), 0);
  const { minTotal, maxTotal } = bounds;
  if (total > maxTotal && out.length) {
    const shrink = total - maxTotal;
    const last = out[out.length - 1];
    const take = Math.min(shrink, Math.max(0, last.end - last.start - MIN_SEGMENT_LEN));
    last.end = clamp(last.end - take, last.start + MIN_SEGMENT_LEN, d);
    total = out.reduce((acc, x) => acc + (x.end - x.start), 0);
  }
  if (total < minTotal && out.length) {
    const grow = minTotal - total;
    const last = out[out.length - 1];
    last.end = clamp(last.end + grow, last.start + MIN_SEGMENT_LEN, d);
  }
  return out;
}

/**
 * @param {ReturnType<typeof heuristicTightenedIntent>} intent
 * @param {number} durationSec
 */
export function variationBoundsFromIntent(intent, durationSec) {
  const cap = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 100;
  let minTotal = clamp(
    Number(intent.duration_seconds_min) || DEFAULT_CLIP_MIN,
    DURATION_HARD_MIN,
    cap,
  );
  let maxTotal = clamp(
    Number(intent.duration_seconds_max) || DEFAULT_CLIP_MAX,
    minTotal + 0.5,
    Math.min(VARIATION_PLAN_MAX_TOTAL, cap + 0.75),
  );
  return { minTotal, maxTotal };
}

export const VARIATION_PLAN_MAX_TOTAL = 100;

/**
 * Intersect base worker bounds with rubric bounds from prompt tightening.
 * @param {{ minTotal: number; maxTotal: number }} base
 * @param {ReturnType<typeof heuristicTightenedIntent>} intent
 * @param {number} durationSec
 */
export function mergePlannerDurationBounds(base, intent, durationSec) {
  const rub = variationBoundsFromIntent(intent, durationSec);
  const minTotal = Math.max(base.minTotal, rub.minTotal);
  let maxTotal = Math.min(base.maxTotal, rub.maxTotal);
  if (minTotal > maxTotal) return base;
  maxTotal = Math.max(maxTotal, minTotal + 0.5);
  return { minTotal, maxTotal };
}
