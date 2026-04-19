/**
 * Stage 2 text → MP4 worker (Pexels + ElevenLabs + ffmpeg).
 * Polls `text_video_jobs` with status `queued`. Uses service role.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import { planShots } from "./text-video/shot-planner.js";
import { fetchPexelsClip, downloadToFile } from "./text-video/pexels-fetch.js";
import { generateVoiceover } from "./text-video/voiceover.js";
import { buildAssFromShotPlan } from "./text-video/captions.js";
import { assembleVideo } from "./text-video/assembler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
// Local monorepo: keys often live in repo root `.env.local` (Next app); load if present.
const rootEnvLocal = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(rootEnvLocal)) {
  dotenv.config({ path: rootEnvLocal, override: false });
}
dotenv.config();

const POLL_MS = 5000;
const BUCKET = "text-video-outputs";

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error(
    "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY",
  );
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function setStatus(id, fields) {
  const { error } = await supabase
    .from("text_video_jobs")
    .update(fields)
    .eq("id", id);
  if (error) {
    console.error("[text-video-worker] setStatus failed", id, error.message);
  }
}

async function claimQueuedJob() {
  const { data: next } = await supabase
    .from("text_video_jobs")
    .select("id")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!next?.id) return null;

  const { data: claimed, error } = await supabase
    .from("text_video_jobs")
    .update({ status: "planning" })
    .eq("id", next.id)
    .eq("status", "queued")
    .select("id, script, voice_id, user_id")
    .maybeSingle();

  if (error || !claimed) return null;
  return claimed;
}

async function processJob(job) {
  const tmpDir = path.join(os.tmpdir(), `tv_${job.id}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const voPath = path.join(tmpDir, "voiceover.mp3");
  const assPath = path.join(tmpDir, "captions.ass");
  const finalPath = path.join(tmpDir, "final.mp4");
  const downloadedClips = [];

  try {
    const shots = await planShots(job.script);
    const planForDb = shots.map((s) => ({
      keyword: s.keyword,
      duration: s.duration,
      caption: s.caption,
    }));
    await supabase
      .from("text_video_jobs")
      .update({ shot_plan: planForDb })
      .eq("id", job.id);

    await setStatus(job.id, { status: "fetching" });

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const clipPath = path.join(tmpDir, `clip_${i}.mp4`);

      let pexelsResult;
      try {
        pexelsResult = await fetchPexelsClip(shot.keyword, shot.duration);
      } catch {
        pexelsResult = await fetchPexelsClip(
          "cinematic nature landscape",
          shot.duration,
        );
      }

      await downloadToFile(pexelsResult.url, clipPath);
      downloadedClips.push(clipPath);
      shots[i] = { ...shot, localPath: clipPath };
    }

    const fullScript = shots.map((s) => s.caption).join(" ");
    await generateVoiceover(fullScript, job.voice_id, voPath);

    buildAssFromShotPlan(shots, assPath);

    await setStatus(job.id, { status: "assembling" });
    await assembleVideo({
      shots,
      voiceoverPath: voPath,
      assPath,
      outputPath: finalPath,
    });

    await setStatus(job.id, { status: "uploading" });
    const fileBuffer = fs.readFileSync(finalPath);
    const storagePath = `${job.user_id}/${job.id}/output.mp4`;

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType: "video/mp4",
        upsert: true,
      });

    if (uploadErr) {
      throw new Error(`Upload failed: ${uploadErr.message}`);
    }

    const { data: signedData, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 60 * 60 * 24);

    if (signErr) {
      throw new Error(`Signed URL failed: ${signErr.message}`);
    }

    await setStatus(job.id, {
      status: "complete",
      output_url: signedData?.signedUrl ?? null,
      storage_path: storagePath,
    });
  } catch (err) {
    console.error(`[text-video-worker] Job ${job.id} failed:`, err);
    await setStatus(job.id, {
      status: "failed",
      error_message:
        err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
    });
  } finally {
    for (const f of [...downloadedClips, voPath, assPath, finalPath]) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function poll() {
  const job = await claimQueuedJob();
  if (job) {
    await processJob(job);
  }
}

console.log("[text-video-worker] Started, polling every", POLL_MS, "ms");
console.log(
  "[text-video-worker] Pexels API key:",
  process.env.PEXELS_API_KEY ? "set" : "MISSING",
);
console.log(
  "[text-video-worker] ElevenLabs API key:",
  process.env.ELEVENLABS_API_KEY ? "set" : "MISSING",
);
console.log(
  "[text-video-worker] OpenAI (shot planner):",
  process.env.OPENAI_API_KEY ? "set" : "MISSING",
);
setInterval(() => void poll().catch(console.error), POLL_MS);
void poll().catch(console.error);
