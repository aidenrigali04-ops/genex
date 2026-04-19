/**
 * GenX video worker — implements `worker/CONTRACT.md`.
 * Uses SUPABASE_SERVICE_ROLE_KEY (admin) for Storage and video_jobs updates.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { spawn } from "node:child_process";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config();

const POLL_MS = 5000;
const TMP_ROOT = "/tmp/genex";
const VIDEOS_BUCKET = "videos";
const ERR_MSG_MAX = 500;

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) {
  throw new Error(
    "Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL (same project URL as the Next app)",
  );
}
const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const openaiKey = requiredEnv("OPENAI_API_KEY");

const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Anon key + RLS → `video_jobs` looks empty and jobs never leave `queued`.
 * Service role can call Auth Admin API; anon cannot.
 */
async function verifySupabaseServiceRole() {
  const { error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });
  if (error) {
    console.error("[worker] service_role check failed:", error.message);
    console.error(
      "[worker] Set SUPABASE_SERVICE_ROLE_KEY to the service_role JWT (Supabase → Project Settings → API), not the anon key. URL must match the web app project.",
    );
    throw error;
  }
  let host = supabaseUrl;
  try {
    host = new URL(supabaseUrl).hostname;
  } catch {
    /* ignore */
  }
  console.log("[worker] Supabase Admin API OK, host:", host);
}

const openai = new OpenAI({ apiKey: openaiKey });

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(jobId, msg) {
  console.log(`[${jobId}] ${msg}`);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function rmDir(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function truncateErr(msg) {
  const t = String(msg ?? "error").slice(0, ERR_MSG_MAX);
  return t;
}

async function failJob(jobId, err) {
  const msg = truncateErr(err?.message ?? err);
  log(jobId, `FAILED: ${msg}`);
  const payload = {
    status: "failed",
    error_message: msg,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from("video_jobs").update(payload).eq("id", jobId);
  if (error) {
    console.error(`[${jobId}] failJob update error`, error.message);
  }
}

async function logQueueDiagnostics() {
  const { count: queuedCount, error: cErr } = await supabaseAdmin
    .from("video_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued");
  if (cErr) {
    console.error("[worker] diagnostics count(queued) error:", cErr.message);
    return;
  }

  const { count: urlQueued, error: uErr } = await supabaseAdmin
    .from("video_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .eq("input_type", "url");

  const { count: uploadClaimable, error: ucErr } = await supabaseAdmin
    .from("video_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .eq("input_type", "upload")
    .not("storage_path", "is", null);

  const { count: uploadWaitingPath, error: uwErr } = await supabaseAdmin
    .from("video_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .eq("input_type", "upload")
    .is("storage_path", null);

  if (uErr) console.error("[worker] diagnostics url_queued error:", uErr.message);
  if (ucErr) console.error("[worker] diagnostics upload_ready error:", ucErr.message);
  if (uwErr) console.error("[worker] diagnostics upload_waiting error:", uwErr.message);

  const claimableApprox = (urlQueued ?? 0) + (uploadClaimable ?? 0);

  const { data: recent, error: rErr } = await supabaseAdmin
    .from("video_jobs")
    .select("id, status, input_type, created_at")
    .order("created_at", { ascending: false })
    .limit(8);
  if (rErr) {
    console.error("[worker] diagnostics recent error:", rErr.message);
    return;
  }
  console.log(
    "[worker] diagnostics: queued_total=",
    queuedCount ?? 0,
    "claimable_approx(url+upload_with_path)=",
    claimableApprox,
    "upload_queued_no_storage_path=",
    uploadWaitingPath ?? 0,
    "recent=",
    JSON.stringify(
      (recent ?? []).map((r) => ({
        id: r.id,
        status: r.status,
        input_type: r.input_type,
      })),
    ),
  );
}

/**
 * Poll for queued jobs; claim with atomic queued → processing.
 * Uses RPC (SECURITY DEFINER) so claims work even when PostgREST table reads
 * do not return rows for the service client while SQL Editor still shows `queued`.
 */
async function claimNextJob() {
  const { data, error } = await supabaseAdmin.rpc(
    "worker_claim_next_video_job",
    {},
  );

  if (error) {
    if (
      error.code === "42883" ||
      /function public\.worker_claim_next_video_job/i.test(error.message ?? "")
    ) {
      console.error(
        "[worker] RPC worker_claim_next_video_job missing — apply supabase/migrations/20260424120000_worker_claim_next_video_job_repair.sql (or 20260421100000 + 20260422120000).",
        error.message,
      );
    } else {
      console.error("[worker] claim RPC error", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
    }
    return null;
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows[0] ?? null;
}

/**
 * YouTube often has no separate mp4 video + m4a audio; forcing
 * `bestvideo[ext=mp4]+bestaudio[ext=m4a]` yields "Requested format is not available".
 * Prefer best video + best audio (any codec), merge to mp4; retry with alternate
 * player clients when the default extractor path fails.
 */
async function downloadUrlWithYtDlp(jobId, inputUrl, outPath, maxAttempts = 3) {
  const strategies = [
    { label: "default extractor", extractorArgs: null },
    {
      label: "youtube player_client=android",
      extractorArgs: "youtube:player_client=android",
    },
    {
      label: "youtube player_client=tv_embedded",
      extractorArgs: "youtube:player_client=tv_embedded",
    },
  ];

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const spec = strategies[(attempt - 1) % strategies.length];
    const args = ["--no-playlist"];
    if (spec.extractorArgs) {
      args.push("--extractor-args", spec.extractorArgs);
    }
    args.push(
      "-f",
      "bv*+ba/b",
      "--merge-output-format",
      "mp4",
      "-o",
      outPath,
      inputUrl,
    );
    try {
      log(
        jobId,
        `Downloading URL with yt-dlp (${spec.label}, attempt ${attempt}/${maxAttempts})…`,
      );
      await runSpawn("yt-dlp", args, { stdio: "inherit" });
      return;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      log(jobId, `yt-dlp attempt ${attempt} failed: ${msg}`);
      if (attempt < maxAttempts) {
        const delayMs = 2000 * attempt;
        await sleep(delayMs);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function downloadUploadToInputMp4(jobId, storagePath, destInputMp4) {
  log(jobId, `Downloading upload from Storage: ${storagePath}`);
  const { data, error } = await supabaseAdmin.storage
    .from(VIDEOS_BUCKET)
    .download(storagePath);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  const buf = Buffer.from(await data.arrayBuffer());
  const tmpRaw = `${destInputMp4}.download`;
  fs.writeFileSync(tmpRaw, buf);
  const ext = path.extname(storagePath).toLowerCase();
  if (ext === ".mp4") {
    fs.renameSync(tmpRaw, destInputMp4);
    return;
  }
  await runSpawn("ffmpeg", [
    "-y",
    "-i",
    tmpRaw,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    destInputMp4,
  ]);
  fs.unlinkSync(tmpRaw);
}

function runSpawn(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: opts.stdio ?? "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

function ffprobeDurationSeconds(filePath) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    p.stdout.on("data", (d) => {
      out += d.toString();
    });
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error("ffprobe failed"));
      const d = parseFloat(out.trim(), 10);
      if (!Number.isFinite(d)) return reject(new Error("Could not read media duration"));
      resolve(d);
    });
  });
}

function ffprobeHasAudio(filePath) {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      filePath,
    ]);
    let out = "";
    p.stdout.on("data", (d) => {
      out += d.toString();
    });
    p.on("close", (code) => {
      if (code !== 0) return resolve(false);
      resolve(out.toLowerCase().includes("audio"));
    });
  });
}

async function prepareWhisperInput(mediaPath, tmpDir) {
  const stat = fs.statSync(mediaPath);
  const maxBytes = 24 * 1024 * 1024;
  if (stat.size <= maxBytes) return mediaPath;
  const audioPath = path.join(tmpDir, "whisper-input.mp3");
  await runSpawn("ffmpeg", [
    "-y",
    "-i",
    mediaPath,
    "-t",
    "1800",
    "-vn",
    "-acodec",
    "libmp3lame",
    "-b:a",
    "64k",
    audioPath,
  ]);
  return audioPath;
}

async function transcribeVerboseJson(jobId, filePath) {
  log(jobId, "Calling Whisper…");
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });
  return transcription;
}

function normalizeWhisperSegments(transcription) {
  const raw = Array.isArray(transcription.segments) ? transcription.segments : [];
  return raw.map((s) => ({
    start: typeof s.start === "number" ? s.start : parseFloat(String(s.start), 10),
    end: typeof s.end === "number" ? s.end : parseFloat(String(s.end), 10),
    text: String(s.text || "").trim(),
  }));
}

/** Max sum of segment lengths (seconds) per variation after clipping to the source. */
const VARIATION_PLAN_MAX_TOTAL_SEC = 100;

const GPT_SYSTEM = `You are a short-form video editor AI. Given a video transcript with timestamps and a user's creative prompt, plan exactly 5 distinct video variations for TikTok/Reels/Shorts.

Critical rules about variation design:
- READ the job_prompt carefully. If the user specified a goal (e.g. "Grow followers", "Promote a product"), EVERY variation label and segment selection must serve that goal.
- If the user specified a niche (e.g. "Fitness", "Faith-forward"), the style_note for each variation must reflect that niche's native content style.
- If the user specified a delivery (e.g. "captions on screen", "voiceover"), the caption_overlay and style_note must reflect that.
- Make each of the 5 variations genuinely different in angle, not just different segments of the same narrative. Name them descriptively: "Hook-first cut", "Story arc", "Contrarian angle", "CTA-led", "Transformation edit".
- Never use generic labels like "Variation 1" or "Short clip".

Rules for total runtime of each variation (sum of segment lengths after clipping to 0…video_duration_sec):
- If video_duration_sec >= 15: each variation should total about 15–100 seconds (prefer 20–60s when the source allows; use up to ~100s for longer sources when it serves the edit).
- If video_duration_sec < 15: use as much strong footage as fits—each variation should total roughly 70–100% of the source length (still use multiple segments when it helps).
Return ONLY a valid JSON object (no markdown fences) with key "variations": an array of exactly 5 objects. Each object: variation_number (1-5), label (string), segments (non-empty array of {start, end} in seconds, within the video), caption_overlay (string or null), style_note (string).`;

/**
 * Models sometimes wrap JSON in ```json fences or prepend text despite response_format.
 */
function extractJsonObjectFromModelContent(raw) {
  if (raw == null) return null;
  let s = typeof raw === "string" ? raw : String(raw);
  s = s.replace(/^\uFEFF/, "").trim();
  if (!s) return null;

  const tryParseObject = (str) => {
    try {
      const v = JSON.parse(str);
      return v && typeof v === "object" ? v : null;
    } catch {
      return null;
    }
  };

  const fence = /```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```/i.exec(s);
  if (fence) {
    const inner = fence[1].trim();
    const fromFence = tryParseObject(inner);
    if (fromFence) return fromFence;
    s = inner;
  }

  let parsed = tryParseObject(s);
  if (parsed) return parsed;

  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i >= 0 && j > i) {
    parsed = tryParseObject(s.slice(i, j + 1));
    if (parsed) return parsed;
  }

  return null;
}

/** Min/max total segment length (seconds) after clipping to the real media duration. */
function variationTotalDurationBounds(durationSec) {
  const d = Number(durationSec);
  const cap = Number.isFinite(d) && d > 0 ? d : VARIATION_PLAN_MAX_TOTAL_SEC;
  const maxTotal = Math.min(VARIATION_PLAN_MAX_TOTAL_SEC + 0.5, cap + 0.75);
  const minTotal =
    cap >= 15
      ? 14.5
      : Math.max(0.25, Math.min(14.5, cap * 0.65));
  return { minTotal, maxTotal };
}

async function planVariationsWithGptOnce(
  prompt,
  transcriptSegments,
  durationSec,
  attemptIndex,
  priorHint,
) {
  const { minTotal, maxTotal } = variationTotalDurationBounds(durationSec);
  const userPayload = {
    job_prompt: prompt,
    video_duration_sec: durationSec,
    transcript_segments: transcriptSegments.slice(0, 400),
    planner_constraints: {
      variation_count: 5,
      total_segment_seconds_min: minTotal,
      total_segment_seconds_max: maxTotal,
    },
    ...(priorHint ? { fix_request: priorHint } : {}),
  };

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: attemptIndex > 0 ? 0.2 : 0.35,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: GPT_SYSTEM },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  const parsed = extractJsonObjectFromModelContent(raw);

  let list;
  if (parsed && Array.isArray(parsed.variations)) {
    list = parsed.variations;
  } else if (Array.isArray(parsed) && parsed.length > 0) {
    list = parsed;
  } else {
    throw new Error("Variations plan: missing or non-array 'variations' (could not parse JSON).");
  }
  if (list.length > 5) list = list.slice(0, 5);
  if (list.length !== 5) {
    throw new Error(
      `Variations plan: expected 5 variations, got ${list.length} (after trimming to max 5).`,
    );
  }

  const out = [];
  for (let idx = 0; idx < 5; idx++) {
    const v = list[idx];
    const n = Math.min(5, Math.max(1, Math.round(Number(v.variation_number ?? idx + 1))));
    const label = typeof v.label === "string" ? v.label : `Variation ${n}`;
    const segsIn = Array.isArray(v.segments) ? v.segments : [];
    const segments = segsIn
      .map((s) => ({
        start: Number(s.start),
        end: Number(s.end),
      }))
      .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);

    if (segments.length === 0) {
      throw new Error(`Variations plan: variation ${idx + 1} has no valid segments.`);
    }

    let total = 0;
    for (const s of segments) {
      const ss = Math.max(0, Math.min(s.start, durationSec));
      const ee = Math.max(ss, Math.min(s.end, durationSec));
      total += ee - ss;
    }

    if (total < minTotal || total > maxTotal) {
      throw new Error(
        `Variations plan: variation ${idx + 1} total clip length ${total.toFixed(1)}s is outside allowed ${minTotal.toFixed(1)}–${maxTotal.toFixed(1)}s for this video.`,
      );
    }

    const capOverlay =
      v.caption_overlay === null || v.caption_overlay === undefined
        ? null
        : String(v.caption_overlay);
    const style_note = typeof v.style_note === "string" ? v.style_note : "";

    out.push({
      variation_number: n,
      label,
      segments,
      caption_overlay: capOverlay,
      style_note,
    });
  }

  return out;
}

function formatGenerationContextWorker(gc) {
  if (gc == null || typeof gc !== "object") return "";
  if (gc.version === 1 && gc.answers && typeof gc.answers === "object") {
    const answers = gc.answers;
    const pick = (key) => String(answers[key] ?? "").trim();

    const goalFromPrimary = pick("primaryOutcome");
    const goalFromGoal = pick("goal");
    const userGoal = [goalFromPrimary, goalFromGoal].filter(Boolean).join(" | ") || "(not specified)";
    const userNiche = pick("niche") || "(not specified)";
    const delivery = pick("voiceoverCaptions") || "(not specified)";

    const mappedKeys = new Set(["primaryOutcome", "goal", "niche", "voiceoverCaptions"]);
    const briefParts = [];
    if (Array.isArray(gc.platforms) && gc.platforms.length) {
      briefParts.push(`Platforms: ${gc.platforms.join(", ")}`);
    }
    for (const [k, v] of Object.entries(answers)) {
      if (mappedKeys.has(k)) continue;
      const t = String(v ?? "").trim();
      if (t) briefParts.push(`${k}: ${t}`);
    }
    if (gc.forkedFromJobId) {
      briefParts.push("Follow-up refinement job (prioritize latest instructions).");
    }
    const editorBrief = briefParts.length ? briefParts.join("\n") : "(none)";

    return [
      `USER GOAL: ${userGoal}`,
      `USER NICHE: ${userNiche}`,
      `DELIVERY: ${delivery}`,
      `EDITOR BRIEF:\n${editorBrief}`,
    ].join("\n");
  }
  try {
    return `User context: ${JSON.stringify(gc)}`;
  } catch {
    return "";
  }
}

async function planVariationsWithGpt(jobId, prompt, transcriptSegments, durationSec) {
  const { minTotal, maxTotal } = variationTotalDurationBounds(durationSec);
  let lastErr = new Error("Variations plan failed after retries.");
  for (let attempt = 0; attempt < 3; attempt++) {
    log(jobId, attempt === 0 ? "Planning variations with GPT-4o…" : `Planning variations retry ${attempt + 1}/3…`);
    let priorHint = null;
    if (attempt > 0) {
      priorHint = `Previous reply was invalid (${String(lastErr.message)}). Reply with a single JSON object only. "variations" must be an array of length exactly 5. Each item needs a non-empty "segments" array of {start,end} in seconds within 0..${Number(durationSec).toFixed(2)}. Each variation's summed segment length (after clipping to the video) must be between ${minTotal.toFixed(2)} and ${maxTotal.toFixed(2)} seconds.`;
    }
    try {
      return await planVariationsWithGptOnce(
        prompt,
        transcriptSegments,
        durationSec,
        attempt,
        priorHint,
      );
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      log(jobId, `Variations plan attempt ${attempt + 1} failed: ${lastErr.message}`);
    }
  }
  throw lastErr;
}

function pickCaptionFontfile() {
  const candidates = [
    process.env.CAPTION_FONT,
    process.env.GENEX_CAPTION_FONT_ARABIC,
    "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans[wdth,wght].ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, "\\%")
    .replace(/\n/g, " ");
}

function buildFilterGraph(jobId, segments, durationSec, hasAudio, captionOverlay) {
  const n = segments.length;
  const vChains = [];
  const vTags = [];
  for (let i = 0; i < n; i++) {
    const s = Math.max(0, Math.min(segments[i].start, durationSec));
    const e = Math.max(s, Math.min(segments[i].end, durationSec));
    const tag = `v${i}`;
    vChains.push(`[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[${tag}]`);
    vTags.push(`[${tag}]`);
  }
  let graph = `${vChains.join(";")};${vTags.join("")}concat=n=${n}:v=1:a=0[vcat]`;
  graph +=
    ";[vcat]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[vscaled]";

  let outVideoTag = "vscaled";
  if (captionOverlay && String(captionOverlay).trim()) {
    const fontfile = pickCaptionFontfile();
    if (fontfile) {
      const escFont = fontfile.replace(/'/g, "'\\''");
      const text = escapeDrawtext(String(captionOverlay).trim());
      const style = process.env.GENEX_CAPTION_STYLE ?? "default";

      // Safe zone: keep captions in bottom-third, 80px margin from edge
      const yPos = style === "top" ? "80" : "h-200";
      const fontSize = style === "large" ? "64" : "52";
      const boxAlpha = style === "minimal" ? "0.0" : "0.55";

      graph += `;[vscaled]drawtext=` +
        `fontfile='${escFont}':` +
        `fontsize=${fontSize}:` +
        `fontcolor=white:` +
        `borderw=3:` +
        `bordercolor=black@0.9:` +
        `text='${text}':` +
        `x=(w-text_w)/2:` +
        `y=${yPos}:` +
        `box=1:` +
        `boxcolor=black@${boxAlpha}:` +
        `boxborderw=20:` +
        `line_spacing=8` +
        `[vout]`;
      outVideoTag = "vout";
    } else {
      log(jobId, "No caption font found; skipping caption overlay.");
    }
  }

  let audioLabel = null;
  if (hasAudio) {
    const aChains = [];
    const aTags = [];
    for (let i = 0; i < n; i++) {
      const s = Math.max(0, Math.min(segments[i].start, durationSec));
      const e = Math.max(s, Math.min(segments[i].end, durationSec));
      const tag = `a${i}`;
      aChains.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[${tag}]`);
      aTags.push(`[${tag}]`);
    }
    graph += `;${aChains.join(";")};${aTags.join("")}concat=n=${n}:v=0:a=1[aout]`;
    audioLabel = "aout";
  }

  return { graph, outVideoTag, audioLabel };
}

async function renderVariationWithFfmpeg(jobId, inputMp4, outPath, plan, durationSec, hasAudio) {
  return new Promise((resolve, reject) => {
    const { graph, outVideoTag, audioLabel } = buildFilterGraph(
      jobId,
      plan.segments,
      durationSec,
      hasAudio,
      plan.caption_overlay,
    );

    const args = [
      "-y",
      "-i",
      inputMp4,
      "-filter_complex",
      graph,
      "-map",
      `[${outVideoTag}]`,
    ];
    if (audioLabel) {
      args.push("-map", `[${audioLabel}]`);
      args.push("-c:a", "aac", "-b:a", "128k");
    } else {
      args.push("-an");
    }
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-movflags", "+faststart", outPath);

    log(jobId, `ffmpeg encoding variation ${plan.variation_number}…`);
    const child = spawn("ffmpeg", args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

/**
 * Optional bed track under the rendered clip (env-driven; use royalty-free audio only).
 * Expects GENEX_BGM_LOCAL_PATH to a readable .mp3/.m4a on the worker filesystem.
 */
async function mixBackgroundMusicIfConfigured(jobId, videoPath, clipDurationSec, hasOriginalAudio) {
  const bgmPath = process.env.GENEX_BGM_LOCAL_PATH?.trim();
  if (!bgmPath) return videoPath;
  if (!fs.existsSync(bgmPath)) {
    log(jobId, `GENEX_BGM_LOCAL_PATH set but file missing: ${bgmPath} — skipping BGM mix.`);
    return videoPath;
  }
  const rawVol = parseFloat(process.env.GENEX_BGM_VOLUME ?? "0.22", 10);
  const vol = Number.isFinite(rawVol) ? Math.min(1, Math.max(0, rawVol)) : 0.22;
  const d = Math.max(0.5, clipDurationSec);
  const outPath = `${videoPath}.bgm.mp4`;
  log(jobId, `Mixing background music (volume ${vol})…`);
  try {
    if (hasOriginalAudio) {
      const filter = `[1:a]aloop=loop=-1:size=2e+09,atrim=0:${d},volume=${vol}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]`;
      await runSpawn("ffmpeg", [
        "-y",
        "-i",
        videoPath,
        "-i",
        bgmPath,
        "-filter_complex",
        filter,
        "-map",
        "0:v",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-t",
        String(d),
        "-movflags",
        "+faststart",
        outPath,
      ]);
    } else {
      const filter = `[1:a]aloop=loop=-1:size=2e+09,atrim=0:${d},volume=${vol}[aout]`;
      await runSpawn("ffmpeg", [
        "-y",
        "-i",
        videoPath,
        "-i",
        bgmPath,
        "-filter_complex",
        filter,
        "-map",
        "0:v",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-t",
        String(d),
        "-movflags",
        "+faststart",
        outPath,
      ]);
    }
    fs.unlinkSync(videoPath);
    fs.renameSync(outPath, videoPath);
    return videoPath;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(jobId, `BGM mix failed (using variation without bed): ${msg}`);
    try {
      fs.rmSync(outPath, { force: true });
    } catch {
      /* ignore */
    }
    return videoPath;
  }
}

async function uploadVariationMp4(userId, jobId, variationNumber, localPath) {
  const storagePath = `outputs/${userId}/${jobId}/variation_${variationNumber}.mp4`;
  const body = fs.readFileSync(localPath);
  const { error: upErr } = await supabaseAdmin.storage
    .from(VIDEOS_BUCKET)
    .upload(storagePath, body, { contentType: "video/mp4", upsert: true });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
  return storagePath;
}

async function processJob(job) {
  const jobId = job.id;
  const userId = job.user_id;
  const tmpDir = path.join(TMP_ROOT, jobId);
  const inputMp4 = path.join(tmpDir, "input.mp4");

  try {
    ensureDir(tmpDir);
    log(jobId, "Processing…");

    if (job.input_type === "url") {
      if (!job.input_url) throw new Error("Missing input_url for url job");
      await downloadUrlWithYtDlp(jobId, job.input_url, inputMp4);
    } else if (job.input_type === "upload") {
      if (!job.storage_path) throw new Error("Missing storage_path for upload job");
      await downloadUploadToInputMp4(jobId, job.storage_path, inputMp4);
    } else {
      throw new Error(`Unknown input_type: ${job.input_type}`);
    }

    log(jobId, "Transcribing…");
    const { error: st1 } = await supabaseAdmin
      .from("video_jobs")
      .update({ status: "transcribing", updated_at: new Date().toISOString() })
      .eq("id", jobId);
    if (st1) throw new Error(st1.message);

    const durationSec = await ffprobeDurationSeconds(inputMp4);
    const whisperIn = await prepareWhisperInput(inputMp4, tmpDir);
    const transcription = await transcribeVerboseJson(jobId, whisperIn);
    const transcriptSegments = normalizeWhisperSegments(transcription);

    log(jobId, "Planning…");
    const { error: st2 } = await supabaseAdmin
      .from("video_jobs")
      .update({ status: "planning", updated_at: new Date().toISOString() })
      .eq("id", jobId);
    if (st2) throw new Error(st2.message);

    const gcBlock = formatGenerationContextWorker(job.generation_context);
    const planningPrompt = gcBlock
      ? `${gcBlock}\n\n---\nEditor brief (required):\n${job.prompt}`
      : job.prompt;

    let planned = await planVariationsWithGpt(
      jobId,
      planningPrompt,
      transcriptSegments,
      durationSec,
    );
    planned = [...planned].sort((a, b) => a.variation_number - b.variation_number);

    log(jobId, "Generating…");
    const { error: st3 } = await supabaseAdmin
      .from("video_jobs")
      .update({ status: "generating", updated_at: new Date().toISOString() })
      .eq("id", jobId);
    if (st3) throw new Error(st3.message);

    const hasAudio = await ffprobeHasAudio(inputMp4);
    const variations = [];
    let failedCount = 0;

    for (const p of planned) {
      const n = p.variation_number;
      const outLocal = path.join(tmpDir, `variation_${n}.mp4`);
      try {
        await renderVariationWithFfmpeg(jobId, inputMp4, outLocal, p, durationSec, hasAudio);
        const clipDur = await ffprobeDurationSeconds(outLocal);
        await mixBackgroundMusicIfConfigured(jobId, outLocal, clipDur, hasAudio);
        const storagePath = await uploadVariationMp4(userId, jobId, n, outLocal);
        try {
          fs.unlinkSync(outLocal);
        } catch {
          /* already gone */
        }
        variations.push({
          variation_number: n,
          label: p.label,
          url: storagePath,
          style_note: p.style_note,
        });
      } catch (e) {
        failedCount += 1;
        const msg = truncateErr(e?.message ?? e);
        log(jobId, `Variation ${n} failed: ${msg}`);
        variations.push({
          variation_number: n,
          label: p.label,
          url: "",
          style_note: p.style_note,
          error: msg,
        });
      }
    }

    const successes = variations.filter((v) => typeof v.url === "string" && v.url.length > 0);
    if (successes.length === 0) {
      throw new Error(
        `All ${planned.length} variation(s) failed. Last errors: ${variations
          .map((v) => v.error)
          .filter(Boolean)
          .join("; ")}`,
      );
    }

    const partialNote =
      failedCount > 0
        ? `${failedCount} of ${planned.length} variations failed; ${successes.length} ready to download.`
        : null;

    log(jobId, "Complete.");
    const { error: finErr } = await supabaseAdmin
      .from("video_jobs")
      .update({
        status: "complete",
        variations,
        error_message: partialNote,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (finErr) throw new Error(finErr.message);
  } catch (err) {
    await failJob(jobId, err);
  } finally {
    rmDir(tmpDir);
    log(jobId, "Cleaned temp directory.");
  }
}

async function requeueStaleJobs() {
  const { error } = await supabaseAdmin.rpc('worker_requeue_stale_jobs');
  if (error && !error.message?.includes("function")) {
    console.error("[worker] requeueStaleJobs error:", error.message);
  }
}

async function tick() {
  await requeueStaleJobs();
  const job = await claimNextJob();
  if (!job) return false;
  log(job.id, "claimed (queued → processing).");
  await processJob(job);
  return true;
}

async function main() {
  ensureDir(TMP_ROOT);
  console.log("[worker] starting", { pollMs: POLL_MS, bucket: VIDEOS_BUCKET });
  await verifySupabaseServiceRole();

  let idleTicks = 0;
  for (;;) {
    try {
      const ran = await tick();
      if (ran) {
        idleTicks = 0;
      } else {
        idleTicks += 1;
        if (idleTicks >= 12) {
          console.log(
            "[worker] idle ~60s: no claimable `queued` row (submit a job from the app while this log runs, or check Table Editor → video_jobs).",
          );
          await logQueueDiagnostics();
          idleTicks = 0;
        }
      }
    } catch (e) {
      console.error("[worker] tick error", e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error("[worker] fatal", e);
  process.exit(1);
});
