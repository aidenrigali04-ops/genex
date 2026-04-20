/**
 * Video clipping pipeline helpers (GenEx worker).
 * Prompt tightening, FFmpeg scene/silence signals, Whisper word boundaries,
 * and deterministic segment refinement — no UI; aligns with worker.js flow.
 */

import { spawn } from "node:child_process";

/** Absolute floor/ceiling for inferred clip totals (seconds); always clamped to source length in planners. */
const DURATION_HARD_MIN = 2;
const DURATION_HARD_MAX = 180;
/** Soft defaults when the model omits explicit min/max — wide window so edits are not over-constrained. */
const DEFAULT_CLIP_MIN = 6;
const DEFAULT_CLIP_MAX = 72;
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

  const range = /\b(\d{1,3})\s*[-–]\s*(\d{1,3})\s*(?:s(?:ec(?:onds)?)?)\b/i.exec(prompt);
  if (range) {
    dmin = clamp(parseInt(range[1], 10), DURATION_HARD_MIN, DURATION_HARD_MAX - 1);
    dmax = clamp(parseInt(range[2], 10), dmin + 1, DURATION_HARD_MAX);
  } else {
    const single = /\b(?:~|about|around)?\s*(\d{1,3})\s*(?:s(?:ec(?:onds)?)?)\b/i.exec(prompt);
    if (single) {
      const v = clamp(parseInt(single[1], 10), DURATION_HARD_MIN, DURATION_HARD_MAX);
      dmin = clamp(v - 8, DURATION_HARD_MIN, v - 1);
      dmax = clamp(v + 12, v + 1, DURATION_HARD_MAX);
    }
  }

  const cap = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 600;
  dmax = Math.min(dmax, cap + 0.5, DURATION_HARD_MAX);
  dmin = Math.min(dmin, dmax - 1);
  if (dmax <= dmin + 0.25) {
    dmax = Math.min(cap + 0.5, DURATION_HARD_MAX, dmin + Math.max(1, cap * 0.35));
  }

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
    clip_count_requested: 5 /** legacy field; source worker uses generation_context.variationCount */,
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
      "Short-form edit: strong cold open, retain narrative coherence, avoid mid-sentence cuts at in/out; total length should follow the user's duration hints (or stay in a natural band for the source).",
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
clip_count_requested (integer 1-12, default 5; informational for rubric),
duration_seconds_min (2–min(175, video_duration_sec−0.5); omit only if truly unspecified),
duration_seconds_max (must exceed min; cap at min(180, video_duration_sec+0.5)),
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
- If the user gives an explicit clip length (seconds or a short range), set duration_seconds_min/max to a generous band around that target (roughly ±25–40% or ±10s for very short clips), still clamped inside the source runtime.
- When the user does NOT specify a length, use a wide default window (about 6–72s, or shorter if the source is shorter than ~72s) so the editor is not over-constrained.
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
    let dmin = clamp(
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
    dmin = Math.min(dmin, Math.max(DURATION_HARD_MIN, dmax - 0.5));
    if (dmax <= dmin + 0.25) {
      const h = heuristicTightenedIntent(prompt, durationSec);
      dmin = h.duration_seconds_min;
      dmax = h.duration_seconds_max;
    }
    const out = {
      version: 1,
      clip_count_requested: clamp(Math.round(Number(j.clip_count_requested) || 5), 1, 12),
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

export const VARIATION_PLAN_MAX_TOTAL = 180;

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

/**
 * Parse refinement "target length" / custom text into a single target second value.
 * @param {unknown} s
 * @returns {number | null}
 */
export function parseRoughTargetSecondsFromLengthAnswer(s) {
  const t = String(s ?? "").trim();
  if (!t) return null;
  if (/^__any_length__$/i.test(t)) return null;
  if (/\b(any length|no preference|editor choose|surprise me)\b/i.test(t)) return null;
  const range = /\b(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:onds)?)?|seconds?)?\b/i.exec(t);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return clamp((a + b) / 2, 1, DURATION_HARD_MAX);
    }
  }
  const labeled = /\b(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:onds)?)?|seconds?)\b/i.exec(t);
  if (labeled && Number.isFinite(Number(labeled[1]))) {
    return clamp(Number(labeled[1]), 1, DURATION_HARD_MAX);
  }
  const bare = t.match(/\d+(?:\.\d+)?/);
  if (bare) {
    const v = Number(bare[0]);
    return Number.isFinite(v) && v > 0 ? clamp(v, 1, DURATION_HARD_MAX) : null;
  }
  return null;
}

/**
 * Maps a user-chosen target (seconds) to planner min/max with generous slack so snapping does not violate bounds.
 * @param {number} targetSec
 * @param {number} durationSec
 */
export function refinementTargetToPlannerBounds(targetSec, durationSec) {
  const cap = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : DURATION_HARD_MAX;
  const maxCap = Math.min(VARIATION_PLAN_MAX_TOTAL + 0.75, cap + 0.75);
  const T = clamp(Number(targetSec), 1, cap);
  const padLow = Math.max(2, T * 0.32);
  const padHi = Math.max(4, T * 0.42);
  let minTotal = clamp(T - padLow, 0.5, maxCap - 1);
  let maxTotal = clamp(T + padHi, minTotal + 0.75, maxCap);
  if (T <= cap * 0.98 && maxTotal < Math.min(maxCap, T + 3)) {
    maxTotal = Math.min(maxCap, Math.max(maxTotal, T + 5));
  }
  return { minTotal, maxTotal };
}

/**
 * How many source clips the user asked for (1–12).
 * @param {unknown} gc
 */
export function readVariationCountFromGenerationContext(gc) {
  const DEFAULT_VARIATION_COUNT = 3;
  const MIN = 1;
  const MAX = 12;
  if (!gc || typeof gc !== "object") return DEFAULT_VARIATION_COUNT;
  const n = Number(/** @type {{ variationCount?: unknown }} */ (gc).variationCount);
  if (!Number.isFinite(n) || Number.isNaN(n)) return DEFAULT_VARIATION_COUNT;
  return Math.min(MAX, Math.max(MIN, Math.floor(n)));
}

/**
 * When the user chose explicit min/max seconds, or a rough length in refinement, that wins over inferred rubric bounds.
 * @param {unknown} gc
 * @param {number} durationSec
 * @returns {{ minTotal: number; maxTotal: number } | null}
 */
export function clipDurationBoundsFromGenerationContext(gc, durationSec) {
  if (!gc || typeof gc !== "object" || gc.version !== 1) return null;

  const mode = String(/** @type {{ clipLengthMode?: unknown }} */ (gc).clipLengthMode).toLowerCase();
  if (mode === "custom") {
    const minRaw = /** @type {{ minDurationSec?: unknown }} */ (gc).minDurationSec;
    const maxRaw = /** @type {{ maxDurationSec?: unknown }} */ (gc).maxDurationSec;
    const hasMin =
      minRaw != null && Number.isFinite(Number(minRaw)) && Number(minRaw) > 0;
    const hasMax =
      maxRaw != null && Number.isFinite(Number(maxRaw)) && Number(maxRaw) > 0;
    if (!hasMin && !hasMax) return null;

    const cap = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : DURATION_HARD_MAX;
    const maxCap = Math.min(VARIATION_PLAN_MAX_TOTAL + 0.75, cap + 0.75);
    const minV = hasMin ? Number(minRaw) : null;
    const maxV = hasMax ? Number(maxRaw) : null;

    let minTotal = 0.25;
    let maxTotal = maxCap;
    if (hasMin && hasMax && minV != null && maxV != null) {
      minTotal = Math.max(0.25, minV * 0.88);
      maxTotal = Math.min(maxCap, maxV * 1.12);
    } else if (hasMin && minV != null) {
      minTotal = Math.max(0.25, minV * 0.82);
      maxTotal = maxCap;
    } else if (hasMax && maxV != null) {
      minTotal = 0.25;
      maxTotal = Math.min(maxCap, maxV * 1.08);
    }
    if (maxTotal <= minTotal + 0.25) {
      maxTotal = Math.min(maxCap, minTotal + 4);
    }
    return { minTotal, maxTotal };
  }

  const answers = gc.answers;
  if (!answers || typeof answers !== "object") return null;
  const raw = String(answers.targetLength ?? "").trim();
  if (!raw) return null;
  if (/^__any_length__$/i.test(raw)) return null;
  if (/\b(any length|no preference|editor choose|surprise me)\b/i.test(raw)) return null;
  const target = parseRoughTargetSecondsFromLengthAnswer(raw);
  if (target == null || !Number.isFinite(target)) return null;
  return refinementTargetToPlannerBounds(target, durationSec);
}
