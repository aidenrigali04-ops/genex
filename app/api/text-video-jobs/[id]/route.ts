import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const patchBodySchema = z.object({
  status: z.literal("cancelled"),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: job, error } = await supabase
    .from("text_video_jobs")
    .select(
      "id, status, script, output_url, error_message, shot_plan, credit_cost, created_at, updated_at",
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

  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
