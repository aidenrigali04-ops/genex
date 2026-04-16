import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { z } from "zod";

import { capSourceTextForClipModel } from "@/lib/clip-model-input";
import { parseClipPackageSections } from "@/lib/clip-package";
import {
  appendPresetToSystemPrompt,
  isGenerationPresetId,
  type GenerationPresetId,
} from "@/lib/generation-presets";
import { fetchUrlAsPlainText } from "@/lib/fetch-url-text";
import type { StoredClipPackageOutputV1 } from "@/lib/generation-output";
import {
  isPlatformId,
  PLATFORM_BY_ID,
  type PlatformId,
} from "@/lib/platforms";
import { extractPlatformSection } from "@/lib/parse-generation-output";
import { sourceFromUpload } from "@/lib/source-from-upload";
import { isUnlimitedCreditsModeServer } from "@/lib/credits-config";
import { streamTextToPlainTextResponse } from "@/lib/stream-text-plain-response";
import { createClient } from "@/lib/supabase/server";
import { fetchYoutubeTranscriptText } from "@/lib/youtube-transcript-server";
import { isYoutubeVideoUrlForTranscript } from "@/lib/youtube-url";

export const maxDuration = 300;

const GENERIC_SYSTEM_PROMPT = `You are an expert content strategist and copywriter. Your job is to analyze the core message, hooks, emotional triggers, and key insights from the provided content, then repurpose it into highly optimized formats for each requested platform. Use platform-specific psychology: TikTok = fast hook + story + CTA, LinkedIn = authority + insight + engagement question, Twitter = punchy + thread structure, Instagram = emotion + visual cue + hashtag strategy. Always lead with the strongest hook. Output each format clearly labeled.`;

const CLIP_PACKAGE_SYSTEM_PROMPT = `You write like a TikTok-native creator and editor, not a marketer. No filler, no “delve”, no “in today’s landscape”, no long intros. Sentences should sound speakable aloud in one breath.

Hard rules:
- Hooks: 3–5 options. Each hook is ONE line, max 14 words, scroll-stopping, conversational. Prefer “I/you/we” and concrete specifics over vague hype.
- Moments: exactly 3 bullets. Each bullet: what to clip + 1 sentence max on why it hits (emotion, tension, contrarian take, transformation, proof, payoff).
- Script: target ~90–120 spoken words total across all [LINE] lines (roughly 35–50s at TikTok pace). Stay inside 30–60s vibe. Every beat must earn the next beat.
- Script format MUST alternate:
  [VISUAL CUE]: ...
  [LINE]: ...
  No paragraphs of prose without those tags.
- CTA: 2–3 lines, max 10 words each, native to TikTok (follow/save/comment keyword/link in bio).
- Caption: 1–2 first lines (first line is the real hook). Then hashtags: 5 niche + 3 broader, no spaces in tags, no #spam.
- B-roll: 6–10 bullets, each starts with a verb (Show / Cut / Punch in / Text on screen / B-roll of …).

Vertical-first: assume 9:16, face-cam or tight framing, fast cuts implied by visual cues.

Output sections in this exact order with these headings (include the numbers):

1. TOP CLIP MOMENTS
2. HOOK (FIRST 3 SECONDS)
3. CLIP SCRIPT (30–60 SECONDS)
4. CTA (CALL TO ACTION)
5. CAPTION HOOK + HASHTAGS
6. B-ROLL / VISUAL IDEAS
7. CREATOR SIGNALS
   - Exactly two lines after the heading (machine-readable):
   FORMAT_TAGS: <pick 2–4 comma-separated from: Hook-heavy, Storytime, Educational, Contrarian, Tutorial-lite, Transformation, Listicle, POV, Controversy>
   LENGTH_HINT_SECONDS: <integer 30–60 based on how long the [LINE] script would take read aloud at TikTok pace>`;

const bodySchema = z.object({
  mode: z.enum(["text", "url"]),
  text: z.string().max(120_000).optional(),
  url: z.string().max(2048).optional(),
  /** When mode is text (e.g. after client-side transcript prefetch), keep original URL in DB. */
  sourceUrl: z.string().max(2048).optional(),
  platforms: z.array(z.string()).min(1),
  preset: z
    .enum(["viral_hook", "storytime", "educational", "contrarian"])
    .optional(),
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

function streamGenerationResponse(opts: {
  supabase: SupabaseServerClient;
  userId: string | null;
  /** Text embedded in the model prompt (may be truncated for TPM). */
  sourceTextForModel: string;
  /** Full source persisted on `generations.input_text`. */
  sourceTextForStorage: string;
  storedInputUrl: string | null;
  orderedPlatforms: PlatformId[];
  preset: GenerationPresetId | undefined;
}) {
  const {
    supabase,
    userId,
    sourceTextForModel,
    sourceTextForStorage,
    storedInputUrl,
    orderedPlatforms,
    preset,
  } = opts;

  const headerLines = orderedPlatforms
    .map((id) => PLATFORM_BY_ID[id].header)
    .join("\n");
  const includesClipPackage = orderedPlatforms.includes("clip_package");
  const baseSystem = includesClipPackage
    ? CLIP_PACKAGE_SYSTEM_PROMPT
    : GENERIC_SYSTEM_PROMPT;
  const systemPrompt = appendPresetToSystemPrompt(baseSystem, preset);

  const userPrompt = `Repurpose the source content for ONLY the following platforms, in this exact order.

Rules:
- Output one section per platform, in the same order as listed.
- Each section MUST begin with the exact header line shown below (including the three # characters), then a single blank line, then the repurposed content.
- Do not add any preamble before the first header.
- Do not skip platforms or reorder them.
- Do not change the header text.

Headers in order:
${headerLines}

Source content:
---
${sourceTextForModel}
---`;

  /** `onFinish` `text` can be empty in edge cases; deltas are authoritative. */
  let streamedTextBuffer = "";

  const result = streamText({
    model: openai("gpt-4o"),
    maxOutputTokens: 8192,
    system: systemPrompt,
    prompt: userPrompt,
    onError({ error }) {
      console.error("[generate] streamText error:", error);
    },
    onChunk({ chunk }) {
      if (chunk.type === "text-delta" && chunk.text) {
        streamedTextBuffer += chunk.text;
      }
    },
    onFinish: async (event) => {
      const fromEvent = typeof event.text === "string" ? event.text : "";
      const lastStepText = event.steps?.at(-1)?.text ?? "";
      const fullText =
        fromEvent.trim() !== ""
          ? fromEvent
          : streamedTextBuffer.trim() !== ""
            ? streamedTextBuffer
            : lastStepText;

      let outputToStore: string = fullText;
      let rowType: "generic" | "clip_package" = "generic";

      if (includesClipPackage) {
        rowType = "clip_package";
        if (!fullText.trim()) {
          outputToStore =
            "Generation finished with no output text. Try Regenerate, or verify OPENAI_API_KEY and model access.";
        } else {
          const clipMarkdown = extractPlatformSection(
            fullText,
            "clip_package",
            orderedPlatforms,
          );
          const payload: StoredClipPackageOutputV1 = {
            version: 1,
            full: fullText,
            clipPackageMarkdown: clipMarkdown,
            clipSections: parseClipPackageSections(clipMarkdown),
            platforms: orderedPlatforms,
          };
          outputToStore = JSON.stringify(payload);
        }
      }

      if (userId) {
        const { error } = await supabase.from("generations").insert({
          user_id: userId,
          input_text: sourceTextForStorage,
          input_url: storedInputUrl,
          platforms: orderedPlatforms,
          output: outputToStore,
          type: rowType,
        });
        if (error) {
          console.error("generations insert failed", error.message);
        }
      }
    },
  });

  return streamTextToPlainTextResponse(result);
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "Missing OPENAI_API_KEY in environment." },
      { status: 500 },
    );
  }

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userId = session?.user?.id ?? null;

  let sourceText = "";
  let storedInputUrl: string | null = null;
  let orderedPlatforms: PlatformId[] = [];
  let preset: GenerationPresetId | undefined;

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return Response.json(
        { error: "Invalid multipart body." },
        { status: 400 },
      );
    }

    const file = form.get("file");
    const platformsField = form.get("platforms");

    if (!(file instanceof File) || file.size === 0) {
      return Response.json(
        { error: "A non-empty file is required." },
        { status: 400 },
      );
    }

    if (typeof platformsField !== "string") {
      return Response.json(
        { error: 'Form field "platforms" must be a JSON array string.' },
        { status: 400 },
      );
    }

    let rawPlatforms: unknown;
    try {
      rawPlatforms = JSON.parse(platformsField);
    } catch {
      return Response.json({ error: "Invalid platforms JSON." }, { status: 400 });
    }

    if (!Array.isArray(rawPlatforms)) {
      return Response.json(
        { error: "platforms must be a JSON array." },
        { status: 400 },
      );
    }

    orderedPlatforms = normalizeOrderedPlatforms(
      rawPlatforms.filter((x): x is string => typeof x === "string"),
    );

    if (orderedPlatforms.length === 0) {
      return Response.json(
        { error: "Select at least one valid platform." },
        { status: 400 },
      );
    }

    const presetField = form.get("preset");
    if (typeof presetField === "string" && presetField.trim()) {
      const p = presetField.trim();
      if (!isGenerationPresetId(p)) {
        return Response.json({ error: "Invalid preset." }, { status: 400 });
      }
      preset = p;
    }

    try {
      const resolved = await sourceFromUpload(file);
      sourceText = resolved.sourceText;
      storedInputUrl = resolved.storedInputUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not read file";
      return Response.json({ error: msg }, { status: 400 });
    }
  } else {
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    }

    const body = parsed.data;
    preset = body.preset;
    orderedPlatforms = normalizeOrderedPlatforms(body.platforms);

    if (orderedPlatforms.length === 0) {
      return Response.json(
        { error: "Select at least one valid platform." },
        { status: 400 },
      );
    }

    if (body.mode === "text") {
      const t = body.text?.trim() ?? "";
      if (!t) {
        return Response.json({ error: "Text is required." }, { status: 400 });
      }
      sourceText = t;
      const src = body.sourceUrl?.trim();
      if (src) storedInputUrl = src;
    } else {
      const u = body.url?.trim() ?? "";
      if (!u) {
        return Response.json({ error: "URL is required." }, { status: 400 });
      }
      storedInputUrl = u;
      if (isYoutubeVideoUrlForTranscript(u)) {
        const fromCaptions = await fetchYoutubeTranscriptText(u);
        if (fromCaptions?.trim()) {
          sourceText = fromCaptions;
        } else {
          try {
            sourceText = await fetchUrlAsPlainText(u);
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Could not read URL";
            return Response.json({ error: msg }, { status: 400 });
          }
        }
      } else {
        try {
          sourceText = await fetchUrlAsPlainText(u);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Could not read URL";
          return Response.json({ error: msg }, { status: 400 });
        }
      }
    }
  }

  if (!sourceText.trim()) {
    return Response.json(
      { error: "No usable text found for that input." },
      { status: 400 },
    );
  }

  if (userId && !isUnlimitedCreditsModeServer()) {
    type CreditRow = {
      success: boolean;
      reason: string | null;
      remaining: number;
    };

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
      { p_user_id: userId, p_cost: 1 },
    );

    if (creditError) {
      if (
        creditError.code === "42883" ||
        creditError.message.includes("function")
      ) {
        console.error(
          "[generate] consume_credits(uuid,int) missing — apply supabase/migrations/20260417140000_video_jobs_storage_consume_credits.sql",
          creditError.message,
        );
      } else {
        console.error("[generate] consume_credits failed", creditError.message);
      }
      return Response.json(
        {
          error: "credit_check_failed",
          message:
            "Could not verify your credits. Confirm the latest Supabase migration is applied.",
        },
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
      if (creditRow?.reason === "no_profile") {
        return Response.json(
          {
            error: "profile_setup",
            message:
              "Could not load your profile for credits. Apply the latest Supabase migration (profiles insert policy + consume_one_credit fix), then try again.",
          },
          { status: 503 },
        );
      }
      return Response.json(
        {
          error: "credit_denied",
          message: creditRow?.reason ?? "Could not use a credit.",
        },
        { status: 403 },
      );
    }
  }

  const { forModel, wasTruncated } = capSourceTextForClipModel(sourceText);
  if (wasTruncated) {
    console.info("[generate] clipped source for model TPM", {
      storedChars: sourceText.length,
      modelChars: forModel.length,
    });
  }

  return streamGenerationResponse({
    supabase,
    userId,
    sourceTextForModel: forModel,
    sourceTextForStorage: sourceText,
    storedInputUrl,
    orderedPlatforms,
    preset,
  });
}
