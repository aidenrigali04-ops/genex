import { z } from "zod";

import { isUnlimitedCreditsModeServer } from "@/lib/credits-config";
import { createClient } from "@/lib/supabase/server";

const TEXT_VIDEO_CREDIT_COST = parseInt(
  process.env.TEXT_VIDEO_CREDIT_COST ?? "5",
  10,
);

const generationIdSchema = z.union([
  z.string().uuid(),
  z.string().regex(/^\d+$/, "generationId must be a UUID or numeric id"),
]);

const bodySchema = z.object({
  script: z.string().min(20).max(8000),
  generationId: generationIdSchema.optional(),
  voiceId: z.string().min(1).max(128).optional(),
});

type CreditRow = {
  success: boolean;
  reason: string | null;
  remaining: number;
};

export async function POST(req: Request) {
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

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const userId = session.user.id;
  const defaultVoice =
    process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
  const voiceId = parsed.data.voiceId ?? defaultVoice;

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

  const { data: job, error } = await supabase
    .from("text_video_jobs")
    .insert({
      user_id: userId,
      generation_id: parsed.data.generationId ?? null,
      script: parsed.data.script,
      voice_id: voiceId,
      credit_cost: TEXT_VIDEO_CREDIT_COST,
    })
    .select("id, status, created_at, credit_cost")
    .single();

  if (error || !job) {
    console.error("[text-video-jobs] insert_failed", error?.message);
    return Response.json({ error: "insert_failed" }, { status: 500 });
  }

  return Response.json({
    ...job,
    ...(typeof creditsRemaining === "number"
      ? { credits_remaining: creditsRemaining }
      : {}),
  });
}
