"use strict";

/**
 * Railway video worker for GenX `video_jobs`.
 *
 * Job status updates try the richer pipeline first (`processing`, `transcribing`,
 * `planning`, `generating`). If your `video_jobs` CHECK constraint only allows the
 * slimmer set (`queued`, `analyzing`, `generating`, `complete`, `failed`), failed
 * updates are skipped so the worker keeps running (see `trySetStatus`).
 *
 * Prerequisites:
 *   - Storage bucket `outputs` (private is fine; URLs are signed).
 *   - Service role can write `outputs` and read `videos`.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ffmpeg = require("fluent-ffmpeg");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const POLL_MS = 5000;
const TMP_ROOT = "/tmp/genex";
const OUTPUT_BUCKET = process.env.OUTPUTS_BUCKET || "outputs";
const SIGNED_URL_SEC = Number(process.env.VARIATION_SIGNED_URL_SEC || 60 * 60 * 24 * 30);

const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const openaiKey = requiredEnv("OPENAI_API_KEY");

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const openai = new OpenAI({ apiKey: openaiKey });

ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || "ffmpeg");
ffmpeg.setFfprobePath(process.env.FFPROBE_PATH || "ffprobe");

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function rmDir(p) {
  fs.rmSync(p, { recursive: true, force: true });
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
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const d = metadata?.format?.duration;
      if (typeof d !== "number" || !Number.isFinite(d)) {
        return reject(new Error("Could not read media duration"));
      }
      resolve(d);
    });
  });
}

async function downloadYoutube(url, outTemplate) {
  await runSpawn("yt-dlp", [
    "-f",
    "bv*+ba/b",
    "--merge-output-format",
    "mp4",
    "-o",
    outTemplate,
    "--no-playlist",
    url,
  ]);
}

function findYtDownloadedFile(dir) {
  const files = fs.readdirSync(dir);
  const mp4 = files.find((f) => f.endsWith(".mp4"));
  if (mp4) return path.join(dir, mp4);
  const mov = files.find((f) => f.endsWith(".mov") || f.endsWith(".webm"));
  if (mov) return path.join(dir, mov);
  throw new Error("yt-dlp did not produce a video file in working directory");
}

async function downloadFromStorage(storagePath, destFile) {
  const { data, error } = await supabase.storage.from("videos").download(storagePath);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  const buf = Buffer.from(await data.arrayBuffer());
  fs.writeFileSync(destFile, buf);
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

async function transcribeVerboseJson(filePath) {
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });
  return transcription;
}

function segmentsForPrompt(transcription) {
  const segments = Array.isArray(transcription.segments) ? transcription.segments : [];
  return segments.map((s) => ({
    start: s.start,
    end: s.end,
    text: String(s.text || "").trim(),
  }));
}

async function planVariations(prompt, transcriptSummary, durationSec) {
  const userPayload = {
    job_prompt: prompt,
    video_duration_sec: durationSec,
    transcript_segments: transcriptSummary,
  };

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You are a short-form video editor. Given a user prompt and timestamped transcript segments,",
          "plan exactly 5 vertical (9:16) short clips from the SAME source video.",
          "Each clip must have: variation_number (1-5), label (short human title), start_sec, end_sec, caption (optional overlay string, single line, or null).",
          "Clips should be between 8 and 45 seconds long, non-overlapping when possible, and aligned to transcript content.",
          "Return JSON: { \"variations\": [ ... exactly 5 ... ] }.",
          "All times must be within [0, video_duration_sec].",
        ].join(" "),
      },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty GPT response");
  const parsed = JSON.parse(raw);
  const list = parsed.variations;
  if (!Array.isArray(list) || list.length !== 5) {
    throw new Error("GPT did not return 5 variations");
  }
  return list.map((v, idx) => {
    const n = Number(v.variation_number ?? idx + 1);
    const start = Number(v.start_sec);
    const end = Number(v.end_sec);
    const label = String(v.label || `Variation ${idx + 1}`);
    const caption = v.caption == null ? null : String(v.caption);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error(`Invalid segment for variation ${n}`);
    }
    return {
      variation_number: Math.min(5, Math.max(1, Math.round(n))),
      label,
      start_sec: start,
      end_sec: end,
      caption,
    };
  });
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
    .replace(/\n/g, " ");
}

function buildVideoFilter(caption) {
  const scaleCrop =
    "scale=1080:1920:force_original_aspect_ratio=increase," +
    "crop=1080:1920";

  if (!caption) return scaleCrop;

  const fontfile = pickCaptionFontfile();
  if (!fontfile) {
    console.warn("[worker] No caption font found; exporting without caption overlay.");
    return scaleCrop;
  }

  const text = escapeDrawtext(caption);
  const draw = [
    `drawtext=fontfile='${fontfile.replace(/'/g, "\\'")}'`,
    "fontsize=48",
    "fontcolor=white",
    "borderw=4",
    "bordercolor=black",
    "x=(w-text_w)/2",
    "y=h-text_h-120",
    `text='${text}'`,
  ].join(":");

  return `${scaleCrop},${draw}`;
}

function ffprobeHasAudio(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const has = (metadata.streams || []).some((s) => s.codec_type === "audio");
      resolve(!!has);
    });
  });
}

async function renderVariation(inputPath, outputPath, start, duration, caption, hasAudio) {
  const vf = buildVideoFilter(caption);
  const opts = [
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-movflags",
    "+faststart",
  ];
  if (hasAudio) {
    opts.push("-c:a", "aac", "-b:a", "128k");
  } else {
    opts.push("-an");
  }

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(start)
      .setDuration(duration)
      .outputOptions(opts)
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
}

async function uploadVariation(userId, jobId, localPath, n) {
  const storagePath = `${userId}/${jobId}/variation_${n}.mp4`;
  const body = fs.readFileSync(localPath);
  const { error: upErr } = await supabase.storage
    .from(OUTPUT_BUCKET)
    .upload(storagePath, body, { contentType: "video/mp4", upsert: true });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  const { data: signed, error: sErr } = await supabase.storage
    .from(OUTPUT_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SEC);
  if (sErr || !signed?.signedUrl) {
    throw new Error(`Signed URL failed: ${sErr?.message || "unknown"}`);
  }
  return { storagePath, url: signed.signedUrl };
}

async function updateJob(id, patch) {
  const { error } = await supabase
    .from("video_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Failed to update job ${id}: ${error.message}`);
}

/** Best-effort status write (ignored if DB CHECK rejects unknown statuses). */
async function trySetStatus(id, status) {
  const { error } = await supabase
    .from("video_jobs")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.warn("[worker] trySetStatus skipped:", status, error.message);
    return false;
  }
  return true;
}

async function failJob(id, err) {
  const msg = err?.message ? String(err.message) : String(err);
  console.error("[worker] job failed", id, msg);

  const payload = {
    status: "failed",
    updated_at: new Date().toISOString(),
    error_message: msg,
  };
  const { error } = await supabase.from("video_jobs").update(payload).eq("id", id);
  if (error) {
    await supabase
      .from("video_jobs")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", id);
  }
}

async function claimNextJob() {
  const { data: row, error } = await supabase
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

  const candidates = ["processing", "analyzing"];
  for (const status of candidates) {
    const { data: updated, error: uerr } = await supabase
      .from("video_jobs")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "queued")
      .select()
      .single();

    if (!uerr && updated) return updated;
  }

  return null;
}

function clampVariationsToDuration(vars, durationSec) {
  return vars.map((v) => {
    let start = Math.max(0, v.start_sec);
    let end = Math.min(durationSec, v.end_sec);
    if (end - start < 4) {
      end = Math.min(durationSec, start + 12);
    }
    if (end > durationSec) end = durationSec;
    if (start >= end) {
      start = Math.max(0, durationSec - 15);
      end = durationSec;
    }
    return { ...v, start_sec: start, end_sec: end };
  });
}

async function processJob(job) {
  const jobId = job.id;
  const userId = job.user_id;
  const tmpDir = path.join(TMP_ROOT, jobId);
  ensureDir(tmpDir);

  let sourcePath;

  if (job.input_type === "url") {
    if (!job.input_url) throw new Error("Missing input_url for url job");
    const tmpl = path.join(tmpDir, "source.%(ext)s");
    await downloadYoutube(job.input_url, tmpl);
    sourcePath = findYtDownloadedFile(tmpDir);
  } else if (job.input_type === "upload") {
    if (!job.storage_path) throw new Error("Missing storage_path for upload job");
    sourcePath = path.join(tmpDir, "source.bin");
    await downloadFromStorage(job.storage_path, sourcePath);
    const ext = path.extname(job.storage_path).toLowerCase();
    if (ext && [".mp4", ".mov", ".webm"].includes(ext)) {
      const renamed = path.join(tmpDir, `source${ext}`);
      fs.renameSync(sourcePath, renamed);
      sourcePath = renamed;
    }
  } else {
    throw new Error(`Unknown input_type: ${job.input_type}`);
  }

  await trySetStatus(jobId, "transcribing");

  const durationSec = await ffprobeDurationSeconds(sourcePath);
  const hasAudio = await ffprobeHasAudio(sourcePath);
  const whisperIn = await prepareWhisperInput(sourcePath, tmpDir);
  const transcription = await transcribeVerboseJson(whisperIn);
  const segList = segmentsForPrompt(transcription);
  const transcriptSummary = segList.slice(0, 200);

  await trySetStatus(jobId, "planning");

  let planned = await planVariations(job.prompt, transcriptSummary, durationSec);
  planned = clampVariationsToDuration(planned, durationSec);

  await trySetStatus(jobId, "generating");

  const variations = [];

  for (let i = 0; i < planned.length; i++) {
    const v = planned[i];
    const n = v.variation_number || i + 1;
    const start = v.start_sec;
    const dur = Math.max(1, v.end_sec - start);
    const outLocal = path.join(tmpDir, `variation_${n}.mp4`);
    await renderVariation(sourcePath, outLocal, start, dur, v.caption, hasAudio);
    const { url } = await uploadVariation(userId, jobId, outLocal, n);
    variations.push({
      variation_number: n,
      label: v.label,
      url,
    });
  }

  await updateJob(jobId, {
    status: "complete",
    variations,
  });

  rmDir(tmpDir);
}

async function tick() {
  const job = await claimNextJob();
  if (!job) return;

  try {
    await processJob(job);
  } catch (err) {
    try {
      rmDir(path.join(TMP_ROOT, job.id));
    } catch {
      /* ignore */
    }
    await failJob(job.id, err);
  }
}

async function main() {
  ensureDir(TMP_ROOT);
  console.log("[worker] starting", { pollMs: POLL_MS, outputBucket: OUTPUT_BUCKET });

  for (;;) {
    try {
      await tick();
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
