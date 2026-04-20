import { z } from "zod";

import {
  normalizeVariationCount,
  textVideoPlannerHintsFromPayload,
  validateDurationOptions,
} from "@/lib/clip-generation-options";
import type { ClipLengthMode } from "@/lib/clip-generation-options";
import { isTextVideoJobsApiEnabled } from "@/lib/text-video-api-enabled";
import { createClient } from "@/lib/supabase/server";
import { planShots } from "@/worker/text-video/shot-planner.js";

const bodySchema = z
  .object({
    script: z.string().min(20).max(8000),
    hookStyle: z.string().min(1).max(64).optional(),
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

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isTextVideoJobsApiEnabled()) {
    return Response.json(
      { error: "text_video_disabled", message: "Preview disabled (ENABLE_TEXT_VIDEO_JOBS)." },
      { status: 503 },
    );
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

  try {
    const plannerHints = textVideoPlannerHintsFromPayload({
      variationCount: normalizeVariationCount(parsed.data.variationCount),
      clipLengthMode: (parsed.data.clipLengthMode ?? "auto") as ClipLengthMode,
      minDurationSec: parsed.data.minDurationSec ?? null,
      maxDurationSec: parsed.data.maxDurationSec ?? null,
    });
    const shots = await planShots(parsed.data.script, {
      hookStyle: parsed.data.hookStyle,
      plannerHints,
    });
    return Response.json({ shots });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to plan shots";
    console.error("[text-video-jobs/preview]", message);
    return Response.json(
      { error: "preview_failed", message: message.slice(0, 200) },
      { status: 502 },
    );
  }
}
