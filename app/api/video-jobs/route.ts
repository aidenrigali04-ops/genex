import { isUnlimitedCreditsModeServer } from "@/lib/credits-config";
import { createClient } from "@/lib/supabase/server";
import { VIDEO_JOB_CREDIT_COST } from "@/lib/video-job-cost";

export const maxDuration = 300;

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const ALLOWED_VIDEO_EXT = new Set([".mp4", ".mov"]);

function extFromFilename(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

/** Safe basename for Storage object keys: inputs/{userId}/{timestamp}-{name} */
function safeStorageFileSegment(originalName: string): string {
  const base = (originalName.split(/[/\\]/).pop() ?? "video.mp4").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
  return cleaned.length > 0 ? cleaned : "video.mp4";
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "sign_in_required" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json(
      { error: "Expected multipart/form-data." },
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
    if (file.size > MAX_VIDEO_BYTES) {
      return Response.json(
        { error: `Video must be under ${MAX_VIDEO_BYTES / (1024 * 1024)} MB.` },
        { status: 400 },
      );
    }
    const ext = extFromFilename(file.name);
    if (!ALLOWED_VIDEO_EXT.has(ext)) {
      return Response.json(
        { error: "Unsupported video format. Use MP4 or MOV." },
        { status: 400 },
      );
    }
  } else {
    if (!youtubeUrl) {
      return Response.json({ error: "YouTube URL is required." }, { status: 400 });
    }
    if (!/^https?:\/\//i.test(youtubeUrl)) {
      return Response.json({ error: "Invalid URL." }, { status: 400 });
    }
  }

  type CreditRow = { success: boolean; reason: string | null; remaining: number };
  let remainingCredits: number | undefined;

  if (!isUnlimitedCreditsModeServer()) {
    const { data: creditData, error: creditError } = await supabase.rpc(
      "consume_credits",
      { p_cost: VIDEO_JOB_CREDIT_COST, p_user_id: userId },
    );

    if (creditError) {
      console.error("[video-jobs] consume_credits", creditError.message);
      return Response.json(
        { error: "credit_check_failed", message: creditError.message },
        { status: 503 },
      );
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
        return Response.json({ error: "no_credits" }, { status: 403 });
      }
      return Response.json(
        {
          error: "credit_denied",
          message: creditRow?.reason ?? "Could not use credits.",
        },
        { status: 403 },
      );
    }
    remainingCredits = creditRow.remaining;
  }

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
    console.error("[video-jobs] insert", insertError?.message);
    return Response.json(
      { error: "Could not create job. Apply the latest Supabase migration." },
      { status: 500 },
    );
  }

  const jobId = job.id as string;

  if (inputType === "upload" && file) {
    const ext = extFromFilename(file.name) || ".mp4";
    const safeExt = ALLOWED_VIDEO_EXT.has(ext) ? ext : ".mp4";
    let fileSeg = safeStorageFileSegment(file.name);
    if (!/\.(mp4|mov)$/i.test(fileSeg)) {
      fileSeg = `${fileSeg.replace(/\.+$/, "")}${safeExt}`;
    }
    const storagePath = `inputs/${userId}/${Date.now()}-${fileSeg}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await supabase.storage
      .from("videos")
      .upload(storagePath, buf, {
        contentType: file.type || "video/mp4",
        upsert: true,
      });

    if (upErr) {
      console.error("[video-jobs] storage upload", upErr.message);
      const bucketMissing = /bucket not found/i.test(upErr.message);
      await supabase
        .from("video_jobs")
        .update({
          status: "failed",
          error_message: upErr.message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      return Response.json(
        {
          error: "upload_failed",
          message: bucketMissing
            ? 'Supabase Storage bucket "videos" is missing. Create a private bucket named exactly `videos` in the Supabase Dashboard (Storage → New bucket), or apply migrations that insert into storage.buckets (e.g. 20260417140000 and 20260419120000_ensure_videos_bucket_outputs_rls.sql).'
            : upErr.message,
        },
        { status: bucketMissing ? 503 : 500 },
      );
    }

    await supabase
      .from("video_jobs")
      .update({
        storage_path: storagePath,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }

  return Response.json({
    id: jobId,
    status: "queued",
    remainingCredits,
  });
}
