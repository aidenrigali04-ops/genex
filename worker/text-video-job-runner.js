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
  if (!raw || !Array.isArray(raw) || raw.length < 6) return null;
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
 * @param {{ id: string; script: string; voice_id: string; user_id: string; shot_plan?: unknown; hook_style?: string | null; clip_engine?: unknown }} job
 */
export async function processTextVideoJob(supabase, job) {
  const tmpDir = path.join(os.tmpdir(), `tv_${job.id}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const voPath = path.join(tmpDir, "voiceover.mp3");
  const assPath = path.join(tmpDir, "captions.ass");
  const finalPath = path.join(tmpDir, "final.mp4");
  /** @type {string[]} */
  const downloadedClips = [];

  try {
    // ── STEP 1: Plan shots ──────────────────────────────────────
    const fromDb = normalizeShotsFromDb(job.shot_plan);
    const clipEngine =
      job.clip_engine && typeof job.clip_engine === "object"
        ? /** @type {{ planner_context_block?: string }} */ (job.clip_engine)
        : null;
    const clipCtx =
      typeof clipEngine?.planner_context_block === "string"
        ? clipEngine.planner_context_block
        : null;
    let shots =
      fromDb ??
      (await planShots(job.script, {
        hookStyle: job.hook_style ?? undefined,
        clipEngineContext: clipCtx,
        supabase,
        jobId: job.id,
        onCheckpoint: async (phase) => {
          const hint =
            phase === "planning_draft_start"
              ? "Planning shots…"
              : phase === "critique_stream_start"
                ? "Reviewing shot plan…"
                : null;
          if (!hint) return;
          await supabase
            .from("text_video_jobs")
            .update({ error_message: hint })
            .eq("id", job.id);
        },
      }));
    await supabase
      .from("text_video_jobs")
      .update({
        shot_plan: shots.map((s) => ({
          keyword: s.keyword,
          duration: s.duration,
          caption: s.caption,
        })),
      })
      .eq("id", job.id);

    await setStatus(supabase, job.id, { status: "fetching" });

    // ── STEP 2: Generate voiceover FIRST (so we can sync to real duration) ──
    const fullScript = shots.map((s) => s.caption).filter(Boolean).join(" ");
    await generateVoiceover(fullScript, job.voice_id, voPath);
    const voDuration = await getAudioDuration(voPath);

    // ── STEP 3: Rescale shot durations to match actual VO length ──
    const totalPlanned = shots.reduce(
      (s, sh) => s + (Number(sh.duration) || 5),
      0,
    );
    if (Math.abs(totalPlanned - voDuration) > 3) {
      const scaleFactor = voDuration / totalPlanned;
      shots = shots.map((sh) => ({
        ...sh,
        duration: Math.min(
          8,
          Math.max(2, Math.round((Number(sh.duration) || 5) * scaleFactor * 10) / 10),
        ),
      }));
    }

    // ── STEP 4: Build captions AFTER rescaling (timing matches VO now) ──
    buildAssFromShotPlan(shots, assPath);

    // ── STEP 5: PARALLEL download all Pexels clips ──────────────
    const clipPaths = new Array(shots.length);
    await Promise.all(
      shots.map(async (shot, i) => {
        const clipPath = path.join(tmpDir, `clip_${i}.mp4`);
        let pexelsResult;
        try {
          pexelsResult = await fetchPexelsClip(shot.keyword, shot.duration);
        } catch {
          pexelsResult = await fetchPexelsClip(
            "person walking urban street",
            shot.duration,
          );
        }
        await downloadToFile(pexelsResult.url, clipPath);
        clipPaths[i] = clipPath;
        shots[i] = { ...shot, localPath: clipPath, pexelsResult };

        await supabase
          .from("text_video_jobs")
          .update({
            error_message: `Getting footage ${i + 1} of ${shots.length}…`,
          })
          .eq("id", job.id);
      }),
    );

    for (const p of clipPaths) {
      if (p) downloadedClips.push(p);
    }

    await supabase
      .from("text_video_jobs")
      .update({ error_message: null })
      .eq("id", job.id);

    await setStatus(supabase, job.id, { status: "assembling" });

    // ── STEP 6: Assemble (pass voDuration for exact -t trim) ─────
    await assembleVideo({
      shots,
      voiceoverPath: voPath,
      assPath,
      outputPath: finalPath,
      voDuration,
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

    const vaultBody = [
      "## Clip vault",
      `job_id=${job.id}`,
      `output=${signedData?.signedUrl ?? "n/a"}`,
      "",
      "### Script",
      job.script.slice(0, 4000),
    ].join("\n");
    const { error: vaultErr } = await supabase.from("clip_vault_entries").insert({
      user_id: job.user_id,
      job_id: job.id,
      body: vaultBody,
    });
    if (vaultErr) {
      console.warn("[text-video] vault_write_failed", vaultErr.message);
    }
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
