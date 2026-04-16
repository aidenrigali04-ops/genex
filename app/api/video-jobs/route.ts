import { isUnlimitedCreditsModeServer } from "@/lib/credits-config";
import {
  assertAllowedVideoUpload,
  buildVideoInputStoragePath,
} from "@/lib/video-job-input-path";
import { logVideoJob } from "@/lib/video-jobs-log";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createClient } from "@/lib/supabase/server";
import { VIDEO_JOB_CREDIT_COST } from "@/lib/video-job-cost";

export const maxDuration = 300;

type CreditRow = { success: boolean; reason: string | null; remaining: number };

async function consumeCreditsIfNeeded(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<
  | { ok: true; remainingCredits?: number }
  | { ok: false; response: Response }
> {
  if (isUnlimitedCreditsModeServer()) {
    return { ok: true };
  }

  const { data: creditData, error: creditError } = await supabase.rpc(
    "consume_credits",
    { p_cost: VIDEO_JOB_CREDIT_COST, p_user_id: userId },
  );

  if (creditError) {
    logVideoJob(
      "consume_credits_failed",
      { userId, message: creditError.message },
      "error",
    );
    return {
      ok: false,
      response: Response.json(
        { error: "credit_check_failed", message: creditError.message },
        { status: 503 },
      ),
    };
  }

  const creditRow = (
    Array.isArray(creditData) ? creditData[0] : creditData
  ) as CreditRow | undefined;

  if (
    !creditRow ||
    typeof creditRow.success !== "boolean" ||
    creditRow.success !== true
  ) {
    if (creditRow?.reason === "no_credits") {
      return {
        ok: false,
        response: Response.json({ error: "no_credits" }, { status: 403 }),
      };
    }
    return {
      ok: false,
      response: Response.json(
        {
          error: "credit_denied",
          message: creditRow?.reason ?? "Could not use credits.",
        },
        { status: 403 },
      ),
    };
  }
  return { ok: true, remainingCredits: creditRow.remaining };
}

/** JSON: YouTube URL jobs (no multipart). */
async function handleJsonUrlJob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const t0 = performance.now();
  const prompt = String(body.prompt ?? "").trim();
  const youtubeUrl = String(body.youtubeUrl ?? "").trim();

  if (!prompt) {
    return Response.json({ error: "Prompt is required." }, { status: 400 });
  }
  if (!youtubeUrl) {
    return Response.json({ error: "YouTube URL is required." }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(youtubeUrl)) {
    return Response.json({ error: "Invalid URL." }, { status: 400 });
  }

  const credits = await consumeCreditsIfNeeded(supabase, userId);
  if (!credits.ok) return credits.response;

  const { data: job, error: insertError } = await supabase
    .from("video_jobs")
    .insert({
      user_id: userId,
      input_type: "url",
      input_url: youtubeUrl,
      storage_path: null,
      prompt,
      status: "queued",
    })
    .select("id, status, created_at")
    .single();

  if (insertError || !job) {
    logVideoJob(
      "insert_failed",
      { userId, message: insertError?.message ?? "no_row" },
      "error",
    );
    return Response.json(
      { error: "Could not create job. Apply the latest Supabase migration." },
      { status: 500 },
    );
  }

  const jobId = job.id as string;
  logVideoJob("job_created_url", {
    userId,
    jobId,
    ms: Math.round(performance.now() - t0),
  });

  return Response.json({
    id: jobId,
    status: "queued",
    remainingCredits: credits.remainingCredits,
  });
}

/** JSON: reserve row + signed upload URL (bytes go client → Storage, not through Next). */
async function handlePrepareDirectUpload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const t0 = performance.now();
  const prompt = String(body.prompt ?? "").trim();
  const filename = String(body.filename ?? "video.mp4");
  const bytes = Number(body.bytes);
  const contentType = String(body.contentType ?? "video/mp4").trim() || "video/mp4";

  if (!prompt) {
    return Response.json({ error: "Prompt is required." }, { status: 400 });
  }
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return Response.json({ error: "Invalid file size." }, { status: 400 });
  }

  const allowed = assertAllowedVideoUpload(filename, bytes);
  if (!allowed.ok) {
    return Response.json({ error: allowed.message }, { status: 400 });
  }

  const credits = await consumeCreditsIfNeeded(supabase, userId);
  if (!credits.ok) return credits.response;

  const { storagePath } = buildVideoInputStoragePath(userId, filename);

  const { data: job, error: insertError } = await supabase
    .from("video_jobs")
    .insert({
      user_id: userId,
      input_type: "upload",
      input_url: null,
      storage_path: null,
      pending_storage_path: storagePath,
      prompt,
      status: "queued",
    })
    .select("id, status, created_at")
    .single();

  if (insertError || !job) {
    logVideoJob(
      "insert_failed",
      { userId, message: insertError?.message ?? "no_row" },
      "error",
    );
    return Response.json(
      {
        error: "Could not create job.",
        message: insertError?.message?.includes("pending_storage_path")
          ? "Apply migration 20260422120000_video_jobs_pending_storage_worker_claim.sql (pending_storage_path + worker claim)."
          : insertError?.message,
      },
      { status: 500 },
    );
  }

  const jobId = job.id as string;
  const storageClient = createServiceRoleClient() ?? supabase;

  const { data: signData, error: signErr } =
    await storageClient.storage.from("videos").createSignedUploadUrl(storagePath, {
      upsert: true,
    });

  if (signErr || !signData) {
    logVideoJob(
      "signed_upload_url_failed",
      { userId, jobId, message: signErr?.message ?? "no_data" },
      "error",
    );
    await supabase
      .from("video_jobs")
      .update({
        status: "failed",
        error_message: signErr?.message ?? "Could not create signed upload URL.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return Response.json(
      { error: "signed_url_failed", message: signErr?.message },
      { status: 500 },
    );
  }

  logVideoJob("prepare_direct_upload", {
    userId,
    jobId,
    bytes,
    storagePath,
    ms: Math.round(performance.now() - t0),
  });

  return Response.json({
    id: jobId,
    status: "queued",
    remainingCredits: credits.remainingCredits,
    directUpload: {
      signedUrl: signData.signedUrl,
      path: signData.path,
      token: signData.token,
      contentType,
    },
  });
}

export async function POST(req: Request) {
  const t0 = performance.now();
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "sign_in_required" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const inputType = String(body.inputType ?? "").trim();
    if (inputType === "url") {
      return handleJsonUrlJob(supabase, userId, body);
    }
    if (inputType === "upload" && body.prepareDirectUpload === true) {
      return handlePrepareDirectUpload(supabase, userId, body);
    }
    return Response.json(
      { error: "Unsupported JSON payload for /api/video-jobs." },
      { status: 400 },
    );
  }

  if (!contentType.includes("multipart/form-data")) {
    return Response.json(
      { error: "Expected application/json or multipart/form-data." },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid multipart body." }, { status: 400 });
  }

  const prompt = String(form.get("prompt") ?? "").trim();
  const inputType = String(form.get("inputType") ?? "").trim();

  if (!prompt) {
    return Response.json({ error: "Prompt is required." }, { status: 400 });
  }

  if (inputType !== "upload" && inputType !== "url") {
    return Response.json({ error: "Invalid inputType." }, { status: 400 });
  }

  const youtubeUrl = String(form.get("youtubeUrl") ?? "").trim();
  const fileField = form.get("file");
  const file = fileField instanceof File && fileField.size > 0 ? fileField : null;

  if (inputType === "upload") {
    if (!file) {
      return Response.json({ error: "Video file is required." }, { status: 400 });
    }
    const allowed = assertAllowedVideoUpload(file.name, file.size);
    if (!allowed.ok) {
      return Response.json({ error: allowed.message }, { status: 400 });
    }
  } else {
    if (!youtubeUrl) {
      return Response.json({ error: "YouTube URL is required." }, { status: 400 });
    }
    if (!/^https?:\/\//i.test(youtubeUrl)) {
      return Response.json({ error: "Invalid URL." }, { status: 400 });
    }
  }

  const credits = await consumeCreditsIfNeeded(supabase, userId);
  if (!credits.ok) return credits.response;

  const { data: job, error: insertError } = await supabase
    .from("video_jobs")
    .insert({
      user_id: userId,
      input_type: inputType,
      input_url: inputType === "url" ? youtubeUrl : null,
      storage_path: null,
      prompt,
      status: "queued",
    })
    .select("id, status, created_at")
    .single();

  if (insertError || !job) {
    logVideoJob(
      "insert_failed",
      { userId, message: insertError?.message ?? "no_row" },
      "error",
    );
    return Response.json(
      { error: "Could not create job. Apply the latest Supabase migration." },
      { status: 500 },
    );
  }

  const jobId = job.id as string;

  if (inputType === "upload" && file) {
    const { storagePath } = buildVideoInputStoragePath(userId, file.name);
    const uploadStarted = performance.now();
    logVideoJob("multipart_upload_begin", {
      userId,
      jobId,
      bytes: file.size,
      storagePath,
    });

    const storageClient = createServiceRoleClient() ?? supabase;
    const { error: upErr } = await storageClient.storage
      .from("videos")
      .upload(storagePath, file, {
        contentType: file.type || "video/mp4",
        upsert: true,
      });

    if (upErr) {
      const status =
        typeof (upErr as { status?: unknown }).status === "number"
          ? (upErr as { status: number }).status
          : undefined;
      const msg = upErr.message ?? "";
      logVideoJob(
        "storage_upload_failed",
        { userId, jobId, status: status ?? 0, message: msg },
        "error",
      );
      const bucketNotFoundMsg = status === 404 && /bucket not found/i.test(msg);
      await supabase
        .from("video_jobs")
        .update({
          status: "failed",
          error_message: msg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      return Response.json(
        {
          error: "upload_failed",
          message: bucketNotFoundMsg
            ? 'Storage returned "Bucket not found" for bucket `videos`. If the bucket exists, common fixes: (1) apply migration 20260420100000_storage_buckets_select_videos.sql (SELECT on storage.buckets for authenticated), (2) set SUPABASE_SERVICE_ROLE_KEY on the server so uploads use the admin client, or (3) create bucket `videos` / run storage.buckets inserts from 20260417140000 and 20260419120000_ensure_videos_bucket_outputs_rls.sql.'
            : msg,
        },
        { status: bucketNotFoundMsg ? 503 : 500 },
      );
    }

    await supabase
      .from("video_jobs")
      .update({
        storage_path: storagePath,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    logVideoJob("multipart_upload_done", {
      userId,
      jobId,
      bytes: file.size,
      storagePath,
      ms: Math.round(performance.now() - uploadStarted),
    });
  }

  logVideoJob("post_complete", {
    userId,
    jobId,
    inputType,
    ms: Math.round(performance.now() - t0),
  });

  return Response.json({
    id: jobId,
    status: "queued",
    remainingCredits: credits.remainingCredits,
  });
}
