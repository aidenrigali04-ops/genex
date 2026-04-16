import { createClient } from "@/lib/supabase/server";
import type { VideoVariationItem } from "@/lib/video-job-types";

const SAMPLE_MP4 =
  "https://www.w3schools.com/html/mov_bbb.mp4";

function stubVariations(): VideoVariationItem[] {
  const labels = [
    "Variation 1 — Hook focused",
    "Variation 2 — Story beat",
    "Variation 3 — Fast cuts",
    "Variation 4 — Emotional peak",
    "Variation 5 — CTA forward",
  ];
  return labels.map((label) => ({ url: SAMPLE_MP4, label }));
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) {
    return Response.json({ error: "sign_in_required" }, { status: 401 });
  }

  const now = () => new Date().toISOString();

  try {
    const { data: job, error: fetchErr } = await supabase
      .from("video_jobs")
      .select("id, status, user_id")
      .eq("id", id)
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (fetchErr || !job) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    if (job.status !== "queued") {
      return Response.json(
        {
          error: "invalid_state",
          message: `Job is ${job.status}, expected queued.`,
        },
        { status: 409 },
      );
    }

    await supabase
      .from("video_jobs")
      .update({ status: "analyzing", updated_at: now() })
      .eq("id", id);

    await delay(900);

    await supabase
      .from("video_jobs")
      .update({ status: "generating", updated_at: now() })
      .eq("id", id);

    await delay(1200);

    const variations = stubVariations();

    const { error: finErr } = await supabase
      .from("video_jobs")
      .update({
        status: "complete",
        variations,
        updated_at: now(),
      })
      .eq("id", id);

    if (finErr) {
      console.error("[video-jobs] process complete", finErr.message);
      await supabase
        .from("video_jobs")
        .update({ status: "failed", updated_at: now() })
        .eq("id", id);
      return Response.json({ error: "persist_failed" }, { status: 500 });
    }

    return Response.json({ ok: true, status: "complete" });
  } catch (e) {
    console.error("[video-jobs] process", e);
    await supabase
      .from("video_jobs")
      .update({ status: "failed", updated_at: now() })
      .eq("id", id);
    return Response.json({ error: "process_failed" }, { status: 500 });
  }
}
