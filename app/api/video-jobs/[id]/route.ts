import { createClient } from "@/lib/supabase/server";

export async function GET(
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

  const { data: job, error } = await supabase
    .from("video_jobs")
    .select(
      "id, user_id, input_type, input_url, storage_path, prompt, status, variations, created_at, updated_at",
    )
    .eq("id", id)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("[video-jobs] get", error.message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }

  if (!job) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json(job);
}
