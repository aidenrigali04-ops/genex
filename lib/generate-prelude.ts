import { z } from "zod";

import { capSourceTextForClipModel } from "@/lib/clip-model-input";
import {
  isGenerationPresetId,
  type GenerationPresetId,
} from "@/lib/generation-presets";
import { fetchUrlAsPlainText } from "@/lib/fetch-url-text";
import {
  isPlatformId,
  type PlatformId,
} from "@/lib/platforms";
import { sourceFromUpload } from "@/lib/source-from-upload";
import { isUnlimitedCreditsModeServer } from "@/lib/credits-config";
import { createClient } from "@/lib/supabase/server";
import { fetchYoutubeTranscriptText } from "@/lib/youtube-transcript-server";
import { isYoutubeVideoUrlForTranscript } from "@/lib/youtube-url";
import type { GenerationContextV1 } from "@/lib/generation-context";
import { trackAha } from "@/lib/analytics";

const generationContextSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(["video_variations", "text_generation"]),
    platforms: z.array(z.string()),
    answers: z.record(z.string(), z.string()),
    confirmedAt: z.string(),
  })
  .passthrough();

const bodySchema = z.object({
  mode: z.enum(["text", "url"]),
  text: z.string().max(120_000).optional(),
  url: z.string().max(2048).optional(),
  sourceUrl: z.string().max(2048).optional(),
  platforms: z.array(z.string()).min(1),
  preset: z
    .enum(["viral_hook", "storytime", "educational", "contrarian"])
    .optional(),
  generationContext: generationContextSchema.optional(),
});

function normalizeOrderedPlatforms(raw: string[]): PlatformId[] {
  const out: PlatformId[] = [];
  const seen = new Set<PlatformId>();
  for (const r of raw) {
    if (!isPlatformId(r) || seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type IncrementGenerationStreakResult = {
  generation_count?: number;
  current_streak?: number;
  longest_streak?: number;
  is_first_gen?: boolean;
  error?: string;
};

export type GeneratePreludeFatal = { fatal: Record<string, unknown> };

export type GeneratePreludeOk = {
  supabase: SupabaseServerClient;
  userId: string | null;
  sourceTextForModel: string;
  sourceTextForStorage: string;
  storedInputUrl: string | null;
  orderedPlatforms: PlatformId[];
  preset: GenerationPresetId | undefined;
  generationContext: GenerationContextV1 | undefined;
  replaySteps: { id: string; label: string }[];
  isFirstGen: boolean;
  newStreak: number;
};

/**
 * Parses the request, consumes credits when needed, bumps streak server-side,
 * and returns everything needed to open the plain-text generation stream.
 * Must run before `new Response(...)` so streak headers can be attached.
 */
export async function runGeneratePrelude(
  req: Request,
): Promise<GeneratePreludeFatal | GeneratePreludeOk> {
  const replaySteps: { id: string; label: string }[] = [];
  const pushStep = (id: string, label: string): void => {
    replaySteps.push({ id, label });
  };

  pushStep("receive", "Receiving your request…");

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id ?? null;

  let sourceText = "";
  let storedInputUrl: string | null = null;
  let orderedPlatforms: PlatformId[] = [];
  let preset: GenerationPresetId | undefined;
  let generationContext: GenerationContextV1 | undefined;

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    pushStep("upload", "Reading your file…");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return { fatal: { error: "bad_request", message: "Invalid multipart body." } };
    }

    const file = form.get("file");
    const platformsField = form.get("platforms");

    if (!(file instanceof File) || file.size === 0) {
      return { fatal: { error: "bad_request", message: "A non-empty file is required." } };
    }

    if (typeof platformsField !== "string") {
      return {
        fatal: {
          error: "bad_request",
          message: 'Form field "platforms" must be a JSON array string.',
        },
      };
    }

    let rawPlatforms: unknown;
    try {
      rawPlatforms = JSON.parse(platformsField);
    } catch {
      return { fatal: { error: "bad_request", message: "Invalid platforms JSON." } };
    }

    if (!Array.isArray(rawPlatforms)) {
      return { fatal: { error: "bad_request", message: "platforms must be a JSON array." } };
    }

    orderedPlatforms = normalizeOrderedPlatforms(
      rawPlatforms.filter((x): x is string => typeof x === "string"),
    );

    if (orderedPlatforms.length === 0) {
      return {
        fatal: {
          error: "bad_request",
          message: "Select at least one valid platform.",
        },
      };
    }

    const presetField = form.get("preset");
    if (typeof presetField === "string" && presetField.trim()) {
      const p = presetField.trim();
      if (!isGenerationPresetId(p)) {
        return { fatal: { error: "bad_request", message: "Invalid preset." } };
      }
      preset = p;
    }

    const gcField = form.get("generationContext");
    if (typeof gcField === "string" && gcField.trim()) {
      try {
        const rawGc = JSON.parse(gcField) as unknown;
        const gcParsed = generationContextSchema.safeParse(rawGc);
        if (gcParsed.success) {
          generationContext = gcParsed.data as GenerationContextV1;
        }
      } catch {
        /* ignore invalid refinement JSON */
      }
    }

    pushStep("transcribe", "Extracting text from your upload…");
    try {
      const resolved = await sourceFromUpload(file);
      sourceText = resolved.sourceText;
      storedInputUrl = resolved.storedInputUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not read file";
      return { fatal: { error: "bad_request", message: msg } };
    }
  } else {
    pushStep("parse", "Reading input…");
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return { fatal: { error: "bad_request", message: "Invalid JSON body" } };
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return {
        fatal: {
          error: "bad_request",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        },
      };
    }

    const bodyParsed = parsed.data;
    preset = bodyParsed.preset;
    generationContext = bodyParsed.generationContext as
      | GenerationContextV1
      | undefined;
    orderedPlatforms = normalizeOrderedPlatforms(bodyParsed.platforms);

    if (orderedPlatforms.length === 0) {
      return {
        fatal: {
          error: "bad_request",
          message: "Select at least one valid platform.",
        },
      };
    }

    if (bodyParsed.mode === "text") {
      const t = bodyParsed.text?.trim() ?? "";
      if (!t) {
        return { fatal: { error: "bad_request", message: "Text is required." } };
      }
      sourceText = t;
      const src = bodyParsed.sourceUrl?.trim();
      if (src) storedInputUrl = src;
    } else {
      const u = bodyParsed.url?.trim() ?? "";
      if (!u) {
        return { fatal: { error: "bad_request", message: "URL is required." } };
      }
      storedInputUrl = u;
      if (isYoutubeVideoUrlForTranscript(u)) {
        pushStep("youtube", "Fetching YouTube captions…");
        const fromCaptions = await fetchYoutubeTranscriptText(u);
        if (fromCaptions?.trim()) {
          sourceText = fromCaptions;
        } else {
          pushStep("fetch", "Fetching page text (fallback)…");
          try {
            sourceText = await fetchUrlAsPlainText(u);
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Could not read URL";
            return { fatal: { error: "bad_request", message: msg } };
          }
        }
      } else {
        pushStep("fetch", "Fetching page content…");
        try {
          sourceText = await fetchUrlAsPlainText(u);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Could not read URL";
          return { fatal: { error: "bad_request", message: msg } };
        }
      }
    }
  }

  pushStep("validate", "Checking source text…");
  if (!sourceText.trim()) {
    return {
      fatal: {
        error: "bad_request",
        message: "No usable text found for that input.",
      },
    };
  }

  if (userId && !isUnlimitedCreditsModeServer()) {
    type CreditRow = {
      success: boolean;
      reason: string | null;
      remaining: number;
    };

    pushStep("credits", "Checking credits…");

    const { error: profileBootstrapErr } = await supabase
      .from("profiles")
      .insert({ id: userId });
    if (
      profileBootstrapErr &&
      profileBootstrapErr.code !== "23505" &&
      !profileBootstrapErr.message.toLowerCase().includes("duplicate")
    ) {
      console.warn(
        "[generate] profiles bootstrap insert:",
        profileBootstrapErr.code,
        profileBootstrapErr.message,
      );
    }

    const { data: creditData, error: creditError } = await supabase.rpc(
      "consume_credits",
      { p_cost: 1, p_user_id: userId },
    );

    if (creditError) {
      if (
        creditError.code === "42883" ||
        creditError.message.includes("function")
      ) {
        console.error(
          "[generate] consume_credits(int,uuid) missing — apply supabase/migrations including 20260418210000_consume_credits_postgrest_arg_order.sql",
          creditError.message,
        );
      } else {
        console.error("[generate] consume_credits failed", creditError.message);
      }
      return {
        fatal: {
          error: "credit_check_failed",
          message:
            "Could not verify your credits. Confirm the latest Supabase migration is applied.",
        },
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
        return { fatal: { error: "no_credits" } };
      }
      if (creditRow?.reason === "no_profile") {
        return {
          fatal: {
            error: "profile_setup",
            message:
              "Could not load your profile for credits. Apply the latest Supabase migration (profiles insert policy + consume_credits), then try again.",
          },
        };
      }
      return {
        fatal: {
          error: "credit_denied",
          message: creditRow?.reason ?? "Could not use a credit.",
        },
      };
    }
  }

  const { forModel, wasTruncated } = capSourceTextForClipModel(sourceText);
  if (wasTruncated) {
    console.info("[generate] clipped source for model TPM", {
      storedChars: sourceText.length,
      modelChars: forModel.length,
    });
    pushStep("truncate", "Trimming source for model limits…");
  }

  let isFirstGen = false;
  let newStreak = 0;

  if (userId) {
    const { data: countRow } = await supabase
      .from("profiles")
      .select("generation_count")
      .eq("id", userId)
      .maybeSingle();
    const gc = countRow as { generation_count?: number } | null;
    const generationCountBefore =
      typeof gc?.generation_count === "number" ? gc.generation_count : 0;

    if (generationCountBefore === 1) {
      void trackAha(supabase, userId, "second_generation");
    }

    const { data: streakData, error: streakError } = await supabase.rpc(
      "increment_generation_streak",
      { p_user_id: userId },
    );

    if (!streakError && streakData) {
      const row = streakData as IncrementGenerationStreakResult;
      if (!row.error) {
        isFirstGen = row.is_first_gen === true;
        newStreak =
          typeof row.current_streak === "number" ? row.current_streak : 0;

        if (newStreak === 3) {
          void trackAha(supabase, userId, "streak_3_days");
        }
        if (newStreak === 7) {
          void trackAha(supabase, userId, "streak_7_days");
        }
      }
    } else if (streakError) {
      console.error(
        "[generate] increment_generation_streak failed",
        streakError.message,
      );
    }
  }

  pushStep("generate", "Generating with GPT-4o…");

  return {
    supabase,
    userId,
    sourceTextForModel: forModel,
    sourceTextForStorage: sourceText,
    storedInputUrl,
    orderedPlatforms,
    preset,
    generationContext,
    replaySteps,
    isFirstGen,
    newStreak,
  };
}
