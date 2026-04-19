import { createClient } from "@/lib/supabase/server";

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
    .select("id, status, output_url, error_message, shot_plan, updated_at")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error?.code === "PGRST116" || !job) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json(job);
}
