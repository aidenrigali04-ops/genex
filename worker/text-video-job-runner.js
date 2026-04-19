/**
 * Shared text → MP4 pipeline (Pexels + ElevenLabs + ffmpeg).
 * Used by worker.js (main tick) and text-video-worker.js (standalone).
 *
 * @typedef {import("@supabase/supabase-js").SupabaseClient} SupabaseClient
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { planShots } from "./text-video/shot-planner.js";
import { fetchPexelsClip, downloadToFile } from "./text-video/pexels-fetch.js";
import { generateVoiceover } from "./text-video/voiceover.js";
import { buildAssFromShotPlan } from "./text-video/captions.js";
import { assembleVideo } from "./text-video/assembler.js";
import { getAudioDuration } from "./text-video/ffprobe-duration.js";

const BUCKET = "text-video-outputs";

/** @param {unknown} raw */
function normalizeShotsFromDb(raw) {
  if (!raw || !Array.isArray(raw) || raw.length < 3) return null;
  return raw.map((sh) => ({
    keyword: String(
      sh.keyword ?? "person talking smartphone vertical energetic",
    ),
    duration: Math.min(8, Math.max(3, Math.round(Number(sh.duration) || 5))),
    caption: String(sh.caption ?? "").slice(0, 200),
  }));
}

/**
 * Atomically claim oldest `queued` row (queued → planning). Prefer RPC over direct table access.
 * @param {SupabaseClient} supabase
 */
export async function claimNextTextVideoJob(supabase) {
  const { data, error } = await supabase.rpc(
    "worker_claim_next_text_video_job",
    {},
  );

  if (error) {
    if (
      error.code === "42883" ||
      /worker_claim_next_text_video_job/i.test(String(error.message ?? ""))
    ) {
      console.error(
        "[text-video] RPC worker_claim_next_text_video_job missing — apply supabase/migrations/20260425100000_worker_claim_next_text_video_job.sql",
        error.message,
      );
    } else {
      console.error("[text-video] claim RPC error", {
        message: error.message,
        code: error.code,
      });
    }
    return null;
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows[0] ?? null;
}

/** @param {SupabaseClient} supabase */
async function setStatus(supabase, id, fields) {
  const { error } = await supabase
    .from("text_video_jobs")
    .update(fields)
    .eq("id", id);
  if (error) {
    console.error("[text-video] setStatus failed", id, error.message);
  }
}

/**
 * @param {SupabaseClient} supabase
 * @param {{ id: string; script: string; voice_id: string; user_id: string; shot_plan?: unknown; hook_style?: string | null }} job
 */
export async function processTextVideoJob(supabase, job) {
  const tmpDir = path.join(os.tmpdir(), `tv_${job.id}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const voPath = path.join(tmpDir, "voiceover.mp3");
  const assPath = path.join(tmpDir, "captions.ass");
  const finalPath = path.join(tmpDir, "final.mp4");
  const downloadedClips = [];

  try {
    let shots =
      normalizeShotsFromDb(job.shot_plan) ??
      (await planShots(job.script, {
        hookStyle: job.hook_style ?? undefined,
      }));

    const planInitial = shots.map((s) => ({
      keyword: s.keyword,
      duration: s.duration,
      caption: s.caption,
    }));
    await supabase
      .from("text_video_jobs")
      .update({ shot_plan: planInitial })
      .eq("id", job.id);

    // 1. Voiceover first (timing source of truth)
    const fullScript = shots.map((s) => s.caption).join(" ");
    await generateVoiceover(fullScript, job.voice_id, voPath);

    // 2. Actual VO duration
    const voDuration = await getAudioDuration(voPath);

    // 3. Rescale shot lengths to match VO (captions + b-roll align)
    const totalPlanned = shots.reduce(
      (s, sh) => s + (Number(sh.duration) || 0),
      0,
    );
    if (totalPlanned <= 0) {
      throw new Error("Shot plan has zero total duration");
    }
    const scaleFactor = voDuration / totalPlanned;
    shots = shots.map((sh) => ({
      ...sh,
      duration: Math.max(2, (Number(sh.duration) || 0) * scaleFactor),
    }));

    const planScaled = shots.map((s) => ({
      keyword: s.keyword,
      duration: s.duration,
      caption: s.caption,
    }));
    await supabase
      .from("text_video_jobs")
      .update({ shot_plan: planScaled })
      .eq("id", job.id);

    // 4. Captions from rescaled timings
    buildAssFromShotPlan(shots, assPath);

    await setStatus(supabase, job.id, { status: "fetching" });

    const clipResults = await Promise.all(
      shots.map(async (shot, i) => {
        const clipPath = path.join(tmpDir, `clip_${i}.mp4`);
        let pexelsResult;
        try {
          pexelsResult = await fetchPexelsClip(shot.keyword, shot.duration);
        } catch {
          pexelsResult = await fetchPexelsClip(
            "person talking camera vertical office",
            shot.duration,
          );
        }
        await downloadToFile(pexelsResult.url, clipPath);
        await setStatus(supabase, job.id, {
          status: "fetching",
          error_message: `Fetching footage ${i + 1} of ${shots.length}…`,
        });
        return { i, clipPath, shot: { ...shot, localPath: clipPath } };
      }),
    );
    for (const { i, clipPath, shot } of clipResults) {
      shots[i] = shot;
      downloadedClips.push(clipPath);
    }

    await setStatus(supabase, job.id, { status: "assembling" });
    await assembleVideo({
      shots,
      voiceoverPath: voPath,
      assPath,
      outputPath: finalPath,
      outputDuration: voDuration,
    });

    await setStatus(supabase, job.id, { status: "uploading" });
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

    await setStatus(supabase, job.id, {
      status: "complete",
      output_url: signedData?.signedUrl ?? null,
      storage_path: storagePath,
      error_message: null,
    });
  } catch (err) {
    console.error(`[text-video] Job ${job.id} failed:`, err);
    await setStatus(supabase, job.id, {
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
