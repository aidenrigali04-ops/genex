import { signVideoJobVariationsForResponse } from "@/lib/video-job-variation-signing";
import { logVideoJob } from "@/lib/video-jobs-log";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
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
      "id, user_id, input_type, input_url, storage_path, prompt, status, variations, error_message, created_at, updated_at, generation_context",
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

  const variationsSigned =
    job.status === "complete"
      ? await signVideoJobVariationsForResponse(supabase, job.variations)
      : job.variations;

  return Response.json({ ...job, variations: variationsSigned });
}

/** After client PUTs the file to the signed upload URL, attach `storage_path` so the worker can claim the job. */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const t0 = performance.now();
  const { id: jobId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "sign_in_required" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.finalizeDirectUpload !== true) {
    return Response.json({ error: "Unsupported PATCH body." }, { status: 400 });
  }

  const { data: row, error: selErr } = await supabase
    .from("video_jobs")
    .select("id, user_id, input_type, storage_path, pending_storage_path")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (selErr) {
    logVideoJob(
      "finalize_select_failed",
      { userId, jobId, message: selErr.message },
      "error",
    );
    return Response.json({ error: "query_failed" }, { status: 500 });
  }

  if (!row) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  if (row.input_type !== "upload") {
    return Response.json({ error: "not_an_upload_job" }, { status: 400 });
  }
  if (row.storage_path) {
    return Response.json({ ok: true, alreadyFinalized: true });
  }

  const pending = row.pending_storage_path as string | null;
  if (!pending?.trim()) {
    return Response.json(
      { error: "no_pending_upload", message: "Job was not created for direct upload." },
      { status: 400 },
    );
  }

  const storageClient = createServiceRoleClient() ?? supabase;
  const { data: exists, error: exErr } = await storageClient.storage
    .from("videos")
    .exists(pending);

  if (exErr) {
    logVideoJob(
      "finalize_exists_check_failed",
      { userId, jobId, message: exErr.message },
      "error",
    );
    return Response.json(
      { error: "storage_check_failed", message: exErr.message },
      { status: 503 },
    );
  }

  if (!exists) {
    logVideoJob("finalize_object_missing", { userId, jobId, pending }, "error");
    return Response.json(
      {
        error: "upload_not_found",
        message:
          "No file found at the reserved path yet. Wait for the upload to finish, then try again.",
      },
      { status: 409 },
    );
  }

  // Prefer service role so the update succeeds even if RLS or PostgREST quirks block the user JWT;
  // ownership is enforced by .eq("user_id", userId) from the verified session.
  const db = createServiceRoleClient() ?? supabase;
  const { data: updated, error: upErr } = await db
    .from("video_jobs")
    .update({
      storage_path: pending,
      pending_storage_path: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("user_id", userId)
    .is("storage_path", null)
    .select("id")
    .maybeSingle();

  if (upErr) {
    logVideoJob(
      "finalize_update_failed",
      { userId, jobId, message: upErr.message },
      "error",
    );
    return Response.json(
      {
        error: "update_failed",
        message: upErr.message,
        hint:
          /pending_storage_path|column/i.test(upErr.message)
            ? "Apply migration 20260422120000_video_jobs_pending_storage_worker_claim.sql in Supabase SQL Editor."
            : undefined,
      },
      { status: 500 },
    );
  }

  if (!updated) {
    logVideoJob("finalize_update_no_row", { userId, jobId }, "error");
    return Response.json(
      {
        error: "update_failed",
        message:
          "No matching job row to update (already finalized or storage_path changed). Try refreshing status.",
      },
      { status: 409 },
    );
  }

  logVideoJob("finalize_direct_upload", {
    userId,
    jobId,
    storagePath: pending,
    ms: Math.round(performance.now() - t0),
  });

  return Response.json({ ok: true, id: jobId });
}
