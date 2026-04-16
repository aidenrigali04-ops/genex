import { logVideoJob } from "@/lib/video-jobs-log";
import { createClient } from "@/lib/supabase/server";
import { VIDEO_JOB_CREDIT_COST } from "@/lib/video-job-cost";
import { isUnlimitedCreditsModeServer } from "@/lib/credits-config";
import { z } from "zod";

const bodySchema = z.object({
  instructions: z.string().min(1).max(12_000),
  focusVariation: z.number().int().min(1).max(5).optional(),
});

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

/**
 * Clone a completed (or failed) job into a new queued job with extra instructions.
 * Reuses the same media inputs; runs a full worker pass (five variations).
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: parentId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "sign_in_required" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "bad_request", message: parsed.error.message },
      { status: 400 },
    );
  }

  const { instructions, focusVariation } = parsed.data;

  const { data: parent, error: selErr } = await supabase
    .from("video_jobs")
    .select(
      "id, user_id, input_type, input_url, storage_path, prompt, generation_context, status",
    )
    .eq("id", parentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (selErr) {
    return Response.json({ error: "query_failed" }, { status: 500 });
  }
  if (!parent) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const st = String(parent.status ?? "");
  if (st !== "complete" && st !== "failed") {
    return Response.json(
      {
        error: "invalid_parent_status",
        message: "Fork is only available after a job finishes.",
      },
      { status: 400 },
    );
  }

  const inputType = parent.input_type as string;
  if (inputType !== "url" && inputType !== "upload") {
    return Response.json({ error: "unsupported_input" }, { status: 400 });
  }

  if (inputType === "url" && !parent.input_url) {
    return Response.json({ error: "missing_input_url" }, { status: 400 });
  }
  if (inputType === "upload" && !parent.storage_path) {
    return Response.json({ error: "missing_storage_path" }, { status: 400 });
  }

  const credits = await consumeCreditsIfNeeded(supabase, userId);
  if (!credits.ok) return credits.response;

  const focusLine =
    focusVariation != null
      ? `Prioritize improving variation ${focusVariation} in the new cuts, while still returning five variations.\n`
      : "";

  const newPrompt = `${String(parent.prompt ?? "").trim()}\n\n---\n[Follow-up job from ${parentId}]\n${focusLine}${instructions.trim()}`;

  const prevCtx = parent.generation_context;
  const mergedContext =
    prevCtx && typeof prevCtx === "object" && !Array.isArray(prevCtx)
      ? {
          ...(prevCtx as Record<string, unknown>),
          forkedFromJobId: parentId,
          forkInstructions: instructions.trim(),
          forkFocusVariation: focusVariation ?? null,
        }
      : {
          forkedFromJobId: parentId,
          forkInstructions: instructions.trim(),
          forkFocusVariation: focusVariation ?? null,
        };

  const insertRow: Record<string, unknown> = {
    user_id: userId,
    input_type: inputType,
    input_url: inputType === "url" ? parent.input_url : null,
    storage_path: inputType === "upload" ? parent.storage_path : null,
    prompt: newPrompt,
    status: "queued",
    generation_context: mergedContext,
  };

  const { data: job, error: insertError } = await supabase
    .from("video_jobs")
    .insert(insertRow)
    .select("id, status, created_at")
    .single();

  if (insertError || !job) {
    logVideoJob(
      "fork_insert_failed",
      { userId, parentId, message: insertError?.message ?? "no_row" },
      "error",
    );
    return Response.json(
      { error: "insert_failed", message: insertError?.message },
      { status: 500 },
    );
  }

  logVideoJob("job_forked", { userId, parentId, childId: job.id });

  return Response.json({
    id: job.id as string,
    status: "queued",
    remainingCredits: credits.remainingCredits,
  });
}
