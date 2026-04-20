import { randomBytes } from "node:crypto";

import { z } from "zod";

import {
  formatToolContextForPlanner,
  runClipToolsForScript,
} from "@/lib/clip-tool-registry";
import { insertClipMemory, searchClipMemory } from "@/lib/clip-vector-memory";
import {
  setClipSessionLastJob,
  withClipExclusive,
} from "@/lib/clip-session-store";
import {
  GUEST_LIFETIME_FREE_CREDITS,
  isUnlimitedCreditsModeServer,
  UNLIMITED_CREDITS_SENTINEL,
} from "@/lib/credits-config";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getTextVideoCreditCost } from "@/lib/text-video-credit-cost";
import { isTextVideoJobsApiEnabled } from "@/lib/text-video-api-enabled";
import {
  normalizeVariationCount,
  textVideoPlannerHintsFromPayload,
  validateDurationOptions,
} from "@/lib/clip-generation-options";
import type { ClipLengthMode } from "@/lib/clip-generation-options";
import { runTextVideoClipEngine } from "@/lib/text-video-clip-engine";

const TEXT_VIDEO_CREDIT_COST = getTextVideoCreditCost();

const generationIdSchema = z.union([
  z.string().uuid(),
  z.string().regex(/^\d+$/, "generationId must be a UUID or numeric id"),
]);

const shotPlanEntrySchema = z.object({
  keyword: z.string().min(1).max(200),
  duration: z.coerce.number().int().min(2).max(12),
  caption: z.string().max(500),
});

const bodySchema = z
  .object({
    script: z.string().min(20).max(8000),
    generationId: generationIdSchema.optional(),
    voiceId: z.string().min(1).max(128).optional(),
    hookStyle: z.string().min(1).max(64).optional(),
    shotPlan: z.array(shotPlanEntrySchema).min(3).max(24).optional(),
    variationCount: z.coerce.number().int().min(1).max(12).optional(),
    clipLengthMode: z.enum(["auto", "custom"]).optional(),
    minDurationSec: z.number().positive().nullish(),
    maxDurationSec: z.number().positive().nullish(),
  })
  .superRefine((data, ctx) => {
    const mode = (data.clipLengthMode ?? "auto") as ClipLengthMode;
    const v = validateDurationOptions({
      clipLengthMode: mode,
      minDurationSec: data.minDurationSec ?? null,
      maxDurationSec: data.maxDurationSec ?? null,
    });
    if (!v.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: v.message,
        path: ["minDurationSec"],
      });
    }
  });

type CreditRow = {
  success: boolean;
  reason: string | null;
  remaining: number;
};

function stripGuestKeys(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };
  delete o.guestMode;
  delete o.guestCreditsRemaining;
  return o;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("text_video_jobs")
    .select(
      "id, script, status, output_url, error_message, credit_cost, created_at",
    )
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    console.error("[text-video-jobs] list_failed", error.message);
    return Response.json({ error: "list_failed" }, { status: 500 });
  }

  return Response.json({ data: data ?? [] });
}

async function handleGuestTextVideoPost(
  parsed: z.infer<typeof bodySchema>,
  guestCreditsRemaining: number,
): Promise<Response> {
  const shadowId = process.env.GENEX_TEXT_VIDEO_GUEST_USER_ID?.trim();
  const admin = createServiceRoleClient();
  if (!shadowId || !admin) {
    return Response.json(
      {
        error: "guest_video_not_configured",
        message:
          "Guest stock video requires GENEX_TEXT_VIDEO_GUEST_USER_ID (Supabase user UUID) and SUPABASE_SERVICE_ROLE_KEY.",
      },
      { status: 503 },
    );
  }

  if (
    !isUnlimitedCreditsModeServer() &&
    guestCreditsRemaining < TEXT_VIDEO_CREDIT_COST
  ) {
    return Response.json(
      { error: "no_credits", message: "Not enough credits." },
      { status: 402 },
    );
  }

  return await withClipExclusive(shadowId, async () => {
    const defaultVoice =
      process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
    const voiceId = parsed.voiceId ?? defaultVoice;

    const shotPlanForInsert = parsed.shotPlan?.length
      ? parsed.shotPlan.map((s) => ({
          keyword: s.keyword,
          duration: s.duration,
          caption: s.caption,
        }))
      : null;

    const { data: recentScripts, error: recentErr } = await admin
      .from("text_video_jobs")
      .select("script")
      .eq("user_id", shadowId)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(5);

    if (recentErr) {
      console.warn("[text-video-jobs] guest recent_scripts:", recentErr.message);
    }

    const [retrievedMemories, toolLines] = await Promise.all([
      searchClipMemory(admin, shadowId, parsed.script),
      runClipToolsForScript(parsed.script),
    ]);
    const toolContextBlock = formatToolContextForPlanner(toolLines);

    const clipBundle = await runTextVideoClipEngine({
      script: parsed.script,
      recentScriptExcerpts: (recentScripts ?? []).map((r) =>
        String(r.script ?? ""),
      ),
      retrievedMemories,
      toolContextBlock,
    });

    if (!clipBundle.evaluated.pass) {
      return Response.json(
        {
          error: "clip_engine_rejected",
          message: clipBundle.evaluated.notes.join(" "),
          details: clipBundle.evaluated.notes,
        },
        { status: 422 },
      );
    }

    if (clipBundle.evaluated.notes.length > 0) {
      console.info("[text-video-jobs] clip_engine_notes", clipBundle.evaluated.notes);
    }

    const resolvedHook =
      parsed.hookStyle?.trim() || clipBundle.hook_style_resolved || undefined;

    const plannerHints = textVideoPlannerHintsFromPayload({
      variationCount: normalizeVariationCount(parsed.variationCount),
      clipLengthMode: (parsed.clipLengthMode ?? "auto") as ClipLengthMode,
      minDurationSec: parsed.minDurationSec ?? null,
      maxDurationSec: parsed.maxDurationSec ?? null,
    });

    const guestPollToken = randomBytes(24).toString("hex");

    const { data: job, error } = await admin
      .from("text_video_jobs")
      .insert({
        user_id: shadowId,
        generation_id: parsed.generationId ?? null,
        script: parsed.script,
        voice_id: voiceId,
        credit_cost: TEXT_VIDEO_CREDIT_COST,
        guest_poll_token: guestPollToken,
        clip_engine: {
          ...clipBundle,
          planner_hints: plannerHints,
        },
        ...(resolvedHook ? { hook_style: resolvedHook } : {}),
        ...(shotPlanForInsert ? { shot_plan: shotPlanForInsert } : {}),
      })
      .select("id, status, created_at, credit_cost")
      .single();

    if (error || !job) {
      console.error("[text-video-jobs] guest insert_failed", error?.message);
      return Response.json({ error: "insert_failed" }, { status: 500 });
    }

    setClipSessionLastJob(shadowId, job.id as string);

    const creditsAfterGuest = isUnlimitedCreditsModeServer()
      ? undefined
      : guestCreditsRemaining - TEXT_VIDEO_CREDIT_COST;

    return Response.json({
      ...job,
      guest_poll_token: guestPollToken,
      guest_mode: true,
      ...(typeof creditsAfterGuest === "number"
        ? { credits_remaining: creditsAfterGuest }
        : {}),
    });
  });
}

export async function POST(req: Request) {
  if (!isTextVideoJobsApiEnabled()) {
    return Response.json(
      {
        error: "text_video_disabled",
        message:
          "Stock video from script is disabled on this deployment (ENABLE_TEXT_VIDEO_JOBS).",
      },
      { status: 503 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const parsedBody = bodySchema.safeParse(stripGuestKeys(json));
  if (!parsedBody.success) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const raw = json as Record<string, unknown>;
  const guestMode = raw.guestMode === true;
  const guestCreditsRaw = raw.guestCreditsRemaining;
  const guestCreditsParsed = z
    .number()
    .int()
    .min(0)
    .max(Math.max(GUEST_LIFETIME_FREE_CREDITS, UNLIMITED_CREDITS_SENTINEL))
    .safeParse(guestCreditsRaw);

  if (!session?.user?.id) {
    if (!guestMode || !guestCreditsParsed.success) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handleGuestTextVideoPost(
      parsedBody.data,
      guestCreditsParsed.data,
    );
  }

  const userId = session.user.id;

  return await withClipExclusive(userId, async () => {
    const defaultVoice =
      process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
    const voiceId = parsedBody.data.voiceId ?? defaultVoice;

    const shotPlanForInsert = parsedBody.data.shotPlan?.length
      ? parsedBody.data.shotPlan.map((s) => ({
          keyword: s.keyword,
          duration: s.duration,
          caption: s.caption,
        }))
      : null;

    const { data: recentScripts, error: recentErr } = await supabase
      .from("text_video_jobs")
      .select("script")
      .eq("user_id", userId)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(5);

    if (recentErr) {
      console.warn("[text-video-jobs] recent_scripts:", recentErr.message);
    }

    const [retrievedMemories, toolLines] = await Promise.all([
      searchClipMemory(supabase, userId, parsedBody.data.script),
      runClipToolsForScript(parsedBody.data.script),
    ]);
    const toolContextBlock = formatToolContextForPlanner(toolLines);

    const clipBundle = await runTextVideoClipEngine({
      script: parsedBody.data.script,
      recentScriptExcerpts: (recentScripts ?? []).map((r) =>
        String(r.script ?? ""),
      ),
      retrievedMemories,
      toolContextBlock,
    });

    if (!clipBundle.evaluated.pass) {
      return Response.json(
        {
          error: "clip_engine_rejected",
          message: clipBundle.evaluated.notes.join(" "),
          details: clipBundle.evaluated.notes,
        },
        { status: 422 },
      );
    }

    if (clipBundle.evaluated.notes.length > 0) {
      console.info("[text-video-jobs] clip_engine_notes", clipBundle.evaluated.notes);
    }

    let creditsRemaining: number | undefined;

    if (!isUnlimitedCreditsModeServer()) {
      const { error: profileBootstrapErr } = await supabase
        .from("profiles")
        .insert({ id: userId });
      if (
        profileBootstrapErr &&
        profileBootstrapErr.code !== "23505" &&
        !profileBootstrapErr.message.toLowerCase().includes("duplicate")
      ) {
        console.warn("[text-video-jobs] profiles bootstrap:", profileBootstrapErr.message);
      }

      const { data: creditData, error: creditError } = await supabase.rpc(
        "consume_credits",
        { p_cost: TEXT_VIDEO_CREDIT_COST, p_user_id: userId },
      );

      if (creditError) {
        console.error("[text-video-jobs] consume_credits failed", creditError.message);
        return Response.json(
          { error: "credit_check_failed", message: "Could not verify credits." },
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
          return Response.json(
            { error: "no_credits", message: "Not enough credits." },
            { status: 402 },
          );
        }
        return Response.json(
          {
            error: "credit_denied",
            message: creditRow?.reason ?? "Could not use credits.",
          },
          { status: 402 },
        );
      }

      creditsRemaining = creditRow.remaining;
    }

    const resolvedHook =
      parsedBody.data.hookStyle?.trim() ||
      clipBundle.hook_style_resolved ||
      undefined;

    const plannerHints = textVideoPlannerHintsFromPayload({
      variationCount: normalizeVariationCount(parsedBody.data.variationCount),
      clipLengthMode: (parsedBody.data.clipLengthMode ?? "auto") as ClipLengthMode,
      minDurationSec: parsedBody.data.minDurationSec ?? null,
      maxDurationSec: parsedBody.data.maxDurationSec ?? null,
    });

    const { data: job, error } = await supabase
      .from("text_video_jobs")
      .insert({
        user_id: userId,
        generation_id: parsedBody.data.generationId ?? null,
        script: parsedBody.data.script,
        voice_id: voiceId,
        credit_cost: TEXT_VIDEO_CREDIT_COST,
        clip_engine: {
          ...clipBundle,
          planner_hints: plannerHints,
        },
        ...(resolvedHook ? { hook_style: resolvedHook } : {}),
        ...(shotPlanForInsert ? { shot_plan: shotPlanForInsert } : {}),
      })
      .select("id, status, created_at, credit_cost")
      .single();

    if (error || !job) {
      console.error("[text-video-jobs] insert_failed", error?.message);
      return Response.json({ error: "insert_failed" }, { status: 500 });
    }

    void insertClipMemory(supabase, {
      userId,
      jobId: job.id as string,
      content: parsedBody.data.script,
    });
    setClipSessionLastJob(userId, job.id as string);

    return Response.json({
      ...job,
      ...(typeof creditsRemaining === "number"
        ? { credits_remaining: creditsRemaining }
        : {}),
    });
  });
}
