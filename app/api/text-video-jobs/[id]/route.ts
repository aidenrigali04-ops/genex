import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const patchBodySchema = z.object({
  status: z.literal("cancelled"),
  guestPoll: z.string().min(32).optional(),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const guestPoll = url.searchParams.get("guestPoll")?.trim();

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (guestPoll && guestPoll.length >= 32) {
    const admin = createServiceRoleClient();
    if (!admin) {
      return Response.json(
        { error: "guest_video_not_configured" },
        { status: 503 },
      );
    }
    const { data: job, error } = await admin
      .from("text_video_jobs")
      .select(
        "id, status, script, output_url, error_message, shot_plan, clip_engine, credit_cost, created_at, updated_at",
      )
      .eq("id", id)
      .eq("guest_poll_token", guestPoll)
      .maybeSingle();

    if (error?.code === "PGRST116" || !job) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    return Response.json(job);
  }

  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: job, error } = await supabase
    .from("text_video_jobs")
    .select(
      "id, status, script, output_url, error_message, shot_plan, clip_engine, credit_cost, created_at, updated_at",
    )
    .eq("id", id)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error?.code === "PGRST116" || !job) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json(job);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const parsed = patchBodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const guestPoll = parsed.data.guestPoll?.trim();

  if (!session?.user?.id) {
    if (!guestPoll || guestPoll.length < 32) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const admin = createServiceRoleClient();
    if (!admin) {
      return Response.json(
        { error: "guest_video_not_configured" },
        { status: 503 },
      );
    }

    const { data: job, error: fetchErr } = await admin
      .from("text_video_jobs")
      .select("id, status")
      .eq("id", id)
      .eq("guest_poll_token", guestPoll)
      .maybeSingle();

    if (fetchErr?.code === "PGRST116" || !job) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    const terminal = new Set(["complete", "failed", "cancelled"]);
    if (terminal.has(job.status)) {
      return Response.json({ error: "bad_state" }, { status: 409 });
    }

    const { error: updateErr } = await admin
      .from("text_video_jobs")
      .update({
        status: "cancelled",
        error_message: "Cancelled",
      })
      .eq("id", id)
      .eq("guest_poll_token", guestPoll);

    if (updateErr) {
      console.error("[text-video-jobs] guest cancel_failed", updateErr.message);
      return Response.json({ error: "update_failed" }, { status: 500 });
    }

    return Response.json({ ok: true });
  }

  const { data: job, error: fetchErr } = await supabase
    .from("text_video_jobs")
    .select("id, status")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (fetchErr?.code === "PGRST116" || !job) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const terminal = new Set(["complete", "failed", "cancelled"]);
  if (terminal.has(job.status)) {
    return Response.json({ error: "bad_state" }, { status: 409 });
  }

  const { error: updateErr } = await supabase
    .from("text_video_jobs")
    .update({
      status: "cancelled",
      error_message: "Cancelled",
    })
    .eq("id", id)
    .eq("user_id", session.user.id);

  if (updateErr) {
    console.error("[text-video-jobs] cancel_failed", updateErr.message);
    return Response.json({ error: "update_failed" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
