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
import {
  GENEX_FATAL_PREFIX,
  GENEX_STEP_PREFIX,
} from "@/lib/generation-stream-protocol";
import {
  pipeStreamTextAsPlainText,
  type StreamTextResult,
} from "@/lib/stream-text-plain-response";
import { createClient } from "@/lib/supabase/server";
import { fetchYoutubeTranscriptText } from "@/lib/youtube-transcript-server";
import { isYoutubeVideoUrlForTranscript } from "@/lib/youtube-url";
import {
  formatGenerationContextForPrompt,
  type GenerationContextV1,
} from "@/lib/generation-context";

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
  /** When mode is text (e.g. after client-side transcript prefetch), keep original URL in DB. */
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

function createGenerationStreamText(opts: {
  supabase: SupabaseServerClient;
  userId: string | null;
  /** Text embedded in the model prompt (may be truncated for TPM). */
  sourceTextForModel: string;
  /** Full source persisted on `generations.input_text`. */
  sourceTextForStorage: string;
  storedInputUrl: string | null;
  orderedPlatforms: PlatformId[];
  preset: GenerationPresetId | undefined;
  generationContext?: GenerationContextV1 | null;
}): StreamTextResult {
  const {
    supabase,
    userId,
    sourceTextForModel,
    sourceTextForStorage,
    storedInputUrl,
    orderedPlatforms,
    preset,
    generationContext,
  } = opts;

  const headerLines = orderedPlatforms
    .map((id) => PLATFORM_BY_ID[id].header)
    .join("\n");
  const includesClipPackage = orderedPlatforms.includes("clip_package");
  const baseSystem = includesClipPackage
    ? CLIP_PACKAGE_SYSTEM_PROMPT
    : GENERIC_SYSTEM_PROMPT;
  const ctxBlock = formatGenerationContextForPrompt(generationContext ?? null);
  const systemPrompt =
    (ctxBlock
      ? `User context from pre-generation refinement (honor every constraint):\n${ctxBlock}\n\n`
      : "") + appendPresetToSystemPrompt(baseSystem, preset);

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
          generation_context: generationContext ?? null,
        });
        if (error) {
          console.error("generations insert failed", error.message);
        }
      }
    },
  });

  return result;
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "Missing OPENAI_API_KEY in environment." },
      { status: 500 },
    );
  }

  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        }
      };

      const step = (id: string, label: string) => {
        controller.enqueue(
          encoder.encode(
            `${GENEX_STEP_PREFIX}${JSON.stringify({ id, label })}\n`,
          ),
        );
      };

      const fatal = (payload: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`${GENEX_FATAL_PREFIX}${JSON.stringify(payload)}\n`),
        );
        close();
      };

      const append = (s: string) => {
        if (s) controller.enqueue(encoder.encode(s));
      };

      try {
        step("receive", "Receiving your request…");
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
          step("upload", "Reading your file…");
          let form: FormData;
          try {
            form = await req.formData();
          } catch {
            fatal({ error: "bad_request", message: "Invalid multipart body." });
            return;
          }

          const file = form.get("file");
          const platformsField = form.get("platforms");

          if (!(file instanceof File) || file.size === 0) {
            fatal({ error: "bad_request", message: "A non-empty file is required." });
            return;
          }

          if (typeof platformsField !== "string") {
            fatal({
              error: "bad_request",
              message: 'Form field "platforms" must be a JSON array string.',
            });
            return;
          }

          let rawPlatforms: unknown;
          try {
            rawPlatforms = JSON.parse(platformsField);
          } catch {
            fatal({ error: "bad_request", message: "Invalid platforms JSON." });
            return;
          }

          if (!Array.isArray(rawPlatforms)) {
            fatal({ error: "bad_request", message: "platforms must be a JSON array." });
            return;
          }

          orderedPlatforms = normalizeOrderedPlatforms(
            rawPlatforms.filter((x): x is string => typeof x === "string"),
          );

          if (orderedPlatforms.length === 0) {
            fatal({
              error: "bad_request",
              message: "Select at least one valid platform.",
            });
            return;
          }

          const presetField = form.get("preset");
          if (typeof presetField === "string" && presetField.trim()) {
            const p = presetField.trim();
            if (!isGenerationPresetId(p)) {
              fatal({ error: "bad_request", message: "Invalid preset." });
              return;
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

          step("transcribe", "Extracting text from your upload…");
          try {
            const resolved = await sourceFromUpload(file);
            sourceText = resolved.sourceText;
            storedInputUrl = resolved.storedInputUrl;
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Could not read file";
            fatal({ error: "bad_request", message: msg });
            return;
          }
        } else {
          step("parse", "Reading input…");
          let json: unknown;
          try {
            json = await req.json();
          } catch {
            fatal({ error: "bad_request", message: "Invalid JSON body" });
            return;
          }

          const parsed = bodySchema.safeParse(json);
          if (!parsed.success) {
            fatal({
              error: "bad_request",
              message: parsed.error.issues.map((i) => i.message).join("; "),
            });
            return;
          }

          const bodyParsed = parsed.data;
          preset = bodyParsed.preset;
          generationContext = bodyParsed.generationContext as
            | GenerationContextV1
            | undefined;
          orderedPlatforms = normalizeOrderedPlatforms(bodyParsed.platforms);

          if (orderedPlatforms.length === 0) {
            fatal({
              error: "bad_request",
              message: "Select at least one valid platform.",
            });
            return;
          }

          if (bodyParsed.mode === "text") {
            const t = bodyParsed.text?.trim() ?? "";
            if (!t) {
              fatal({ error: "bad_request", message: "Text is required." });
              return;
            }
            sourceText = t;
            const src = bodyParsed.sourceUrl?.trim();
            if (src) storedInputUrl = src;
          } else {
            const u = bodyParsed.url?.trim() ?? "";
            if (!u) {
              fatal({ error: "bad_request", message: "URL is required." });
              return;
            }
            storedInputUrl = u;
            if (isYoutubeVideoUrlForTranscript(u)) {
              step("youtube", "Fetching YouTube captions…");
              const fromCaptions = await fetchYoutubeTranscriptText(u);
              if (fromCaptions?.trim()) {
                sourceText = fromCaptions;
              } else {
                step("fetch", "Fetching page text (fallback)…");
                try {
                  sourceText = await fetchUrlAsPlainText(u);
                } catch (e) {
                  const msg = e instanceof Error ? e.message : "Could not read URL";
                  fatal({ error: "bad_request", message: msg });
                  return;
                }
              }
            } else {
              step("fetch", "Fetching page content…");
              try {
                sourceText = await fetchUrlAsPlainText(u);
              } catch (e) {
                const msg = e instanceof Error ? e.message : "Could not read URL";
                fatal({ error: "bad_request", message: msg });
                return;
              }
            }
          }
        }

        step("validate", "Checking source text…");
        if (!sourceText.trim()) {
          fatal({
            error: "bad_request",
            message: "No usable text found for that input.",
          });
          return;
        }

        if (userId && !isUnlimitedCreditsModeServer()) {
          type CreditRow = {
            success: boolean;
            reason: string | null;
            remaining: number;
          };

          step("credits", "Checking credits…");

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
            fatal({
              error: "credit_check_failed",
              message:
                "Could not verify your credits. Confirm the latest Supabase migration is applied.",
            });
            return;
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
              fatal({ error: "no_credits" });
              return;
            }
            if (creditRow?.reason === "no_profile") {
              fatal({
                error: "profile_setup",
                message:
                  "Could not load your profile for credits. Apply the latest Supabase migration (profiles insert policy + consume_credits), then try again.",
              });
              return;
            }
            fatal({
              error: "credit_denied",
              message: creditRow?.reason ?? "Could not use a credit.",
            });
            return;
          }
        }

        const { forModel, wasTruncated } = capSourceTextForClipModel(sourceText);
        if (wasTruncated) {
          console.info("[generate] clipped source for model TPM", {
            storedChars: sourceText.length,
            modelChars: forModel.length,
          });
          step("truncate", "Trimming source for model limits…");
        }

        step("generate", "Generating with GPT-4o…");

        const result = createGenerationStreamText({
          supabase,
          userId,
          sourceTextForModel: forModel,
          sourceTextForStorage: sourceText,
          storedInputUrl,
          orderedPlatforms,
          preset,
          generationContext: generationContext ?? null,
        });

        await pipeStreamTextAsPlainText(result, append);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        fatal({ error: "exception", message: msg });
        return;
      } finally {
        close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
