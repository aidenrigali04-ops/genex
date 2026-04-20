import type { SupabaseClient } from "@supabase/supabase-js";

/** Funnel: primary = source clipping (`video_jobs`); secondary = stock-from-script (`text_video_jobs`). */
export type AhaEvent =
  | "clip_identified" // first clip timestamp surfaces from a video input
  | "copy_hook" // user copies any hook — PRIMARY north star
  | "copy_caption" // user copies caption/hashtags
  | "copy_script" // user copies script
  | "copy_cta" // user copies CTA
  | "video_played" // text-to-video output is played
  | "second_generation" // user generates for the 2nd time (session 2 signal)
  | "voice_profile_saved" // user saves niche/tone/hook_style to profile
  | "voice_profile_complete" // all three voice fields filled for the first time
  | "hook_strength_high" // output panel surfaced a high hook-strength signal
  | "variation_launched" // user opens video variation workspace
  | "video_job_submitted" // primary: user queued a source clip job (video_jobs)
  | "text_video_started" // secondary: user launched stock-from-script (text_video_jobs)
  | "first_generation_complete" // user's very first clip package finished streaming
  | "streak_3_days"
  | "streak_7_days"
  | "first_gen_celebration"
  | "project_restored"
  | "new_project_started"
  | "refine_plan_loaded"
  | "refine_plan_purpose_detected"
  | "refine_open_answer_submitted"
  | "memory_recall_hit"
  | "session_restored"
  | "generation_titled";

export async function trackAha(
  supabase: SupabaseClient,
  userId: string,
  event: AhaEvent,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from("aha_events").insert({
      user_id: userId,
      event,
      metadata: metadata ?? null,
    });
  } catch {
    // analytics must never throw — silent fail
  }
}
