/**
 * Long-source (≈15 min–2 h) tier: chunked ASR, timeline windowing, two-stage planning.
 * No UI; consumed by worker.js. Quality-first defaults with env overrides.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function slog(jobId, msg) {
  console.log(`[${jobId}] [long-source] ${msg}`);
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

/**
 * @param {number} durationSec
 * @param {number} fileSizeBytes
 */
export function getSourceProcessingPlan(durationSec, fileSizeBytes) {
  const longSec = Number(process.env.GENEX_LONG_SOURCE_SEC) || 900;
  const maxBytes = Number(process.env.GENEX_ASR_MAX_BYTES) || 22 * 1024 * 1024;
  const chunkSec = clamp(Number(process.env.GENEX_ASR_CHUNK_SEC) || 840, 300, 1200);
  const d = Number(durationSec) || 0;
  const isLongDuration = d >= longSec;
  const isLargeFile = fileSizeBytes > maxBytes;
  const isLong = isLongDuration || isLargeFile;
  const twoStage =
    process.env.GENEX_FORCE_TWO_STAGE_PLAN === "1" ||
    isLongDuration ||
    (isLargeFile && d >= 420);

  return {
    isLong,
    /** Chunked Whisper when long or file would exceed API size limits */
    chunkedAsr: isLong,
    chunkSec,
    /** Downscaled scene probe (same timeline) */
    useProxyScene: isLong,
    /** Mono 16k WAV silencedetect */
    useWavSilence: isLong,
    /** Mini model picks windows; GPT-4o plans only inside union+padded transcript */
    twoStagePlan: twoStage,
    longSec,
  };
}

function runFfmpeg(args, inherit = true) {
  return new Promise((resolve, reject) => {
    const c = spawn("ffmpeg", args, {
      stdio: inherit ? "inherit" : ["ignore", "ignore", "pipe"],
      env: process.env,
    });
    let err = "";
    if (!inherit) c.stderr?.on("data", (x) => (err += x.toString()));
    c.on("error", reject);
    c.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-500)}`));
    });
  });
}

/**
 * @param {string} inputMp4
 * @param {string} outMp3
 * @param {number} startSec
 * @param {number} lenSec
 */
export async function extractMp3Chunk(inputMp4, outMp3, startSec, lenSec) {
  await runFfmpeg([
    "-y",
    "-ss",
    String(Math.max(0, startSec)),
    "-i",
    inputMp4,
    "-t",
    String(Math.max(1, lenSec)),
    "-vn",
    "-acodec",
    "libmp3lame",
    "-b:a",
    "64k",
    "-ar",
    "16000",
    outMp3,
  ]);
}

/**
 * @param {unknown} jobId
 * @param {string} inputMp4
 * @param {string} tmpDir
 * @param {number} durationSec
 * @param {number} chunkSec
 * @param {(jobId: unknown, mp3Path: string) => Promise<unknown>} transcribeFn
 */
export async function transcribeChunkedMedia(jobId, inputMp4, tmpDir, durationSec, chunkSec, transcribeFn) {
  const chunks = [];
  const d = Number(durationSec) || 0;
  let n = 0;
  for (let offset = 0; offset < d; offset += chunkSec) {
    const len = Math.min(chunkSec, d - offset);
    const out = path.join(tmpDir, `asr_chunk_${offset}.mp3`);
    slog(jobId, `ASR chunk ${n + 1} t=${offset.toFixed(0)}s len=${len.toFixed(0)}s…`);
    await extractMp3Chunk(inputMp4, out, offset, len);
    const tr = await transcribeFn(jobId, out);
    try {
      fs.unlinkSync(out);
    } catch {
      /* ignore */
    }
    chunks.push({ offset, tr });
    n += 1;
  }
  slog(jobId, `Merged ${chunks.length} ASR chunk(s)`);
  return mergeChunkedTranscriptions(chunks, d);
}

/**
 * @param {{ offset: number, tr: unknown }[]} chunks
 * @param {number} durationSec
 */
export function mergeChunkedTranscriptions(chunks, durationSec) {
  const segments = [];
  const words = [];
  let textParts = [];

  for (const { offset, tr } of chunks) {
    const rawSeg = Array.isArray(tr?.segments) ? tr.segments : [];
    for (const s of rawSeg) {
      const st =
        (typeof s.start === "number" ? s.start : parseFloat(String(s.start), 10)) + offset;
      const en =
        (typeof s.end === "number" ? s.end : parseFloat(String(s.end), 10)) + offset;
      if (!Number.isFinite(st) || !Number.isFinite(en) || en <= st) continue;
      segments.push({
        start: st,
        end: en,
        text: String(s.text || "").trim(),
      });
    }
    const rawW = Array.isArray(tr?.words) ? tr.words : [];
    for (const w of rawW) {
      const st =
        (typeof w.start === "number" ? w.start : parseFloat(String(w.start), 10)) + offset;
      const en =
        (typeof w.end === "number" ? w.end : parseFloat(String(w.end), 10)) + offset;
      if (!Number.isFinite(st) || !Number.isFinite(en) || en <= st) continue;
      words.push({ word: String(w.word || "").trim(), start: st, end: en });
    }
    if (typeof tr?.text === "string" && tr.text.trim()) textParts.push(tr.text.trim());
  }

  segments.sort((a, b) => a.start - b.start);
  words.sort((a, b) => a.start - b.start);

  return {
    text: textParts.join("\n\n").slice(0, 120_000),
    segments,
    words,
    duration: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : undefined,
  };
}

/**
 * Coarsen transcript for outline model (spread across full timeline).
 * @param {{ start: number, end: number, text: string }[]} segments
 * @param {number} durationSec
 * @param {number} maxBlocks
 * @param {number} targetSpanSec
 */
export function buildTimelineBlocks(segments, durationSec, maxBlocks, targetSpanSec = 40) {
  const sorted = [...segments]
    .filter((s) => s.end > s.start && Number.isFinite(s.start))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  let cur = null;
  for (const s of sorted) {
    const t = String(s.text || "").trim();
    if (!cur) {
      cur = { t0: s.start, t1: s.end, parts: t ? [t] : [] };
      continue;
    }
    const span = cur.t1 - cur.t0;
    if (s.start <= cur.t1 + 0.05 || span < targetSpanSec * 0.85) {
      cur.t1 = Math.max(cur.t1, s.end);
      if (t) cur.parts.push(t);
    } else {
      merged.push(cur);
      cur = { t0: s.start, t1: s.end, parts: t ? [t] : [] };
    }
  }
  if (cur) merged.push(cur);

  const blocks = merged.map((b, i) => ({
    i,
    t0: round3(clamp(b.t0, 0, durationSec)),
    t1: round3(clamp(b.t1, 0, durationSec)),
    text: b.parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 300),
  }));

  if (blocks.length <= maxBlocks) return blocks;
  const stride = Math.ceil(blocks.length / maxBlocks);
  const out = [];
  for (let i = 0; i < blocks.length; i += stride) out.push(blocks[i]);
  const last = blocks[blocks.length - 1];
  if (out[out.length - 1]?.i !== last?.i) out.push(last);
  return out;
}

/**
 * @param {number} durationSec
 * @param {number} n
 */
export function heuristicPlanningWindows(durationSec, n = 12) {
  const d = Number(durationSec) || 0;
  if (d <= 0) return [];
  const w = d / n;
  return Array.from({ length: n }, (_, i) => ({
    start: round3(i * w),
    end: round3(Math.min(d, (i + 1) * w)),
    label: `Segment ${i + 1}`,
  }));
}

/**
 * @param {{ start: number, end: number, label?: string }[]} windows
 * @param {number} durationSec
 */
function mergeWindows(windows, durationSec) {
  const d = Number(durationSec) || 0;
  const cleaned = windows
    .map((w) => ({
      start: clamp(Number(w.start) || 0, 0, d),
      end: clamp(Number(w.end) || 0, 0, d),
      label: typeof w.label === "string" ? w.label : "",
    }))
    .filter((w) => w.end > w.start + 1)
    .sort((a, b) => a.start - b.start);
  if (!cleaned.length) return [];
  const out = [cleaned[0]];
  for (let i = 1; i < cleaned.length; i++) {
    const prev = out[out.length - 1];
    const cur = cleaned[i];
    if (cur.start <= prev.end + 2) {
      prev.end = Math.max(prev.end, cur.end);
      if (cur.label) prev.label = `${prev.label} / ${cur.label}`.slice(0, 200);
    } else out.push({ ...cur });
  }
  return out;
}

/**
 * GPT-4o-mini: pick diverse high-value windows across the full timeline.
 * @param {import("openai").OpenAI} openai
 * @param {unknown} jobId
 * @param {ReturnType<typeof buildTimelineBlocks>} blocks
 * @param {number} durationSec
 * @param {string} userHint
 */
export async function selectPlanningWindowsOpenAI(openai, jobId, blocks, durationSec, userHint) {
  const d = Number(durationSec) || 0;
  if (!blocks.length) {
    return mergeWindows(heuristicPlanningWindows(d, 12), d);
  }
  if (d <= 120 || blocks.length <= 8) {
    return [{ start: 0, end: d, label: "full" }];
  }

  const model = process.env.GENEX_PLAN_WINDOWS_MODEL?.trim() || "gpt-4o-mini";
  const system = `You help clip LONG videos into shorts. Given coarse timeline blocks (each has t0,t1 seconds and text snippet), pick 10–16 NON-OVERLAPPING windows covering the FULL 0..video_duration_sec timeline with emphasis on diversity (spread windows; include strong-opinion, story, data, and conclusion-like blocks when visible).
Return ONLY JSON: { "windows": [ { "start": number, "end": number, "label": string } ] }
Rules:
- Every window: 45 <= (end-start) <= 420 seconds when possible.
- Windows must lie within 0..video_duration_sec.
- Prefer boundaries aligned to block t0/t1.
- Cover early, middle, and late portions (do not only pick the first 20 minutes).`;

  const user = JSON.stringify({
    video_duration_sec: d,
    editor_hint: userHint.slice(0, 2500),
    timeline_blocks: blocks.slice(0, 170),
  });

  try {
    const res = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const raw = res.choices[0]?.message?.content;
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed.windows) ? parsed.windows : [];
    const merged = mergeWindows(arr, d);
    if (merged.length >= 3) {
      slog(jobId, `Planning windows from ${model}: ${merged.length}`);
      return merged;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    slog(jobId, `Window selection failed (${msg}) — heuristic bands`);
  }
  return mergeWindows(heuristicPlanningWindows(d, 12), d);
}

/**
 * @param {{ start: number, end: number, text: string }[]} segments
 * @param {{ start: number, end: number }[]} windows
 * @param {number} durationSec
 * @param {number} padSec
 * @param {number} maxSegments
 */
export function filterSegmentsForPlanner(segments, windows, durationSec, padSec, maxSegments) {
  const d = Number(durationSec) || 0;
  if (!windows || windows.length === 0) return segments.slice(0, maxSegments);
  const pad = clamp(Number(padSec) || 55, 20, 120);
  const intervals = windows.map((w) => ({
    s: clamp(w.start - pad, 0, d),
    e: clamp(w.end + pad, 0, d),
  }));
  intervals.sort((a, b) => a.s - b.s);
  const mergedI = [];
  for (const it of intervals) {
    if (!mergedI.length || it.s > mergedI[mergedI.length - 1].e + 0.5) mergedI.push({ ...it });
    else mergedI[mergedI.length - 1].e = Math.max(mergedI[mergedI.length - 1].e, it.e);
  }
  const filtered = segments.filter((seg) =>
    mergedI.some((m) => seg.end > m.s && seg.start < m.e),
  );
  if (filtered.length <= maxSegments) return filtered;
  const stride = Math.ceil(filtered.length / maxSegments);
  const out = [];
  for (let i = 0; i < filtered.length; i += stride) out.push(filtered[i]);
  const last = filtered[filtered.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
