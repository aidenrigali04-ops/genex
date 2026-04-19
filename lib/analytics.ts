import type { SupabaseClient } from "@supabase/supabase-js";

export type AhaEvent =
  | "clip_identified" // first clip timestamp surfaces from a video input
  | "copy_hook" // user copies any hook — PRIMARY north star
  | "copy_caption" // user copies caption/hashtags
  | "copy_script" // user copies script
  | "copy_cta" // user copies CTA
  | "video_played" // text-to-video output is played
  | "second_generation" // user generates for the 2nd time (session 2 signal)
  | "voice_profile_saved" // user saves niche/tone/hook_style to profile
  | "variation_launched" // user opens video variation workspace
  | "text_video_started"; // user launches text-to-video job

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
