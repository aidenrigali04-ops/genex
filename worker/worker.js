"use strict";

/**
 * GenX video worker — implements `worker/CONTRACT.md`.
 * Uses SUPABASE_SERVICE_ROLE_KEY (admin) for Storage and video_jobs updates.
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config();

const fs = require("fs");
const { execSync, spawn } = require("child_process");

const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

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

function posixQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
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

/**
 * Poll for queued jobs; claim with atomic queued → processing.
 */
async function claimNextJob() {
  const { data: row, error } = await supabaseAdmin
    .from("video_jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[worker] claim select error", error.message);
    return null;
  }
  if (!row) return null;

  const { data: updated, error: uerr } = await supabaseAdmin
    .from("video_jobs")
    .update({
      status: "processing",
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "queued")
    .select()
    .single();

  if (uerr || !updated) return null;
  return updated;
}

function downloadUrlWithYtDlp(jobId, inputUrl, outPath) {
  log(jobId, "Downloading URL with yt-dlp…");
  const cmd =
    `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" ` +
    `--merge-output-format mp4 -o ${posixQuote(outPath)} ${posixQuote(inputUrl)}`;
  execSync(cmd, {
    stdio: "inherit",
    maxBuffer: 1024 * 1024 * 200,
    env: process.env,
  });
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
    const { spawn: sp } = require("child_process");
    const p = sp("ffprobe", [
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
  return new Promise((resolve, reject) => {
    const { spawn: sp } = require("child_process");
    const p = sp("ffprobe", [
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

const GPT_SYSTEM = `You are a short-form video editor AI. Given a video transcript with timestamps and a user's creative prompt, plan exactly 5 distinct video variations for TikTok/Reels/Shorts. Each variation must be 15–60 seconds. Return ONLY a valid JSON object with key 'variations' containing an array of 5 objects, each with: variation_number (1-5), label (string), segments (array of {start, end} in seconds), caption_overlay (string or null), style_note (string)`;

async function planVariationsWithGpt(jobId, prompt, transcriptSegments, durationSec) {
  log(jobId, "Planning variations with GPT-4o…");
  const userPayload = {
    job_prompt: prompt,
    video_duration_sec: durationSec,
    transcript_segments: transcriptSegments.slice(0, 400),
  };

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.35,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: GPT_SYSTEM },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error("GPT-4o returned invalid JSON for variations plan");
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.variations)) {
    throw new Error("GPT-4o returned invalid JSON for variations plan");
  }

  const list = parsed.variations;
  if (list.length !== 5) {
    throw new Error("GPT-4o returned invalid JSON for variations plan");
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
      throw new Error("GPT-4o returned invalid JSON for variations plan");
    }

    let total = 0;
    for (const s of segments) {
      const ss = Math.max(0, Math.min(s.start, durationSec));
      const ee = Math.max(ss, Math.min(s.end, durationSec));
      total += ee - ss;
    }

    if (total < 14.5 || total > 60.5) {
      throw new Error("GPT-4o returned invalid JSON for variations plan");
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

function pickCaptionFontfile() {
  const candidates = [
    process.env.CAPTION_FONT,
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
      graph += `;[vscaled]drawtext=fontfile='${escFont}':fontsize=52:fontcolor=white:borderw=2:bordercolor=black@0.8:text='${text}':x=(w-text_w)/2:y=h-200:box=1:boxcolor=black@0.55:boxborderw=18[vout]`;
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
      downloadUrlWithYtDlp(jobId, job.input_url, inputMp4);
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

    let planned = await planVariationsWithGpt(
      jobId,
      job.prompt,
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

    for (const p of planned) {
      const n = p.variation_number;
      const outLocal = path.join(tmpDir, `variation_${n}.mp4`);
      await renderVariationWithFfmpeg(jobId, inputMp4, outLocal, p, durationSec, hasAudio);
      const storagePath = await uploadVariationMp4(userId, jobId, n, outLocal);
      variations.push({
        variation_number: n,
        label: p.label,
        url: storagePath,
        style_note: p.style_note,
      });
    }

    log(jobId, "Complete.");
    const { error: finErr } = await supabaseAdmin
      .from("video_jobs")
      .update({
        status: "complete",
        variations,
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

async function tick() {
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
            "[worker] idle ~60s: no `queued` jobs visible — confirm same Supabase project as Vercel/Railway web, service_role key, and `video_jobs` migration applied.",
          );
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
