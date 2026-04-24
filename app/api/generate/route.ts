import { openai } from "@ai-sdk/openai";
import { APICallError, streamText } from "ai";

import { parseClipPackageSections } from "@/lib/clip-package";
import {
  appendPresetToSystemPrompt,
  type GenerationPresetId,
} from "@/lib/generation-presets";
import type { StoredClipPackageOutputV1 } from "@/lib/generation-output";
import { PLATFORM_BY_ID, type PlatformId } from "@/lib/platforms";
import { extractPlatformSection } from "@/lib/parse-generation-output";
import {
  GENEX_FATAL_PREFIX,
  GENEX_STEP_PREFIX,
} from "@/lib/generation-stream-protocol";
import {
  pipeStreamTextAsPlainText,
  type PlainTextStreamOutcome,
  type StreamTextResult,
} from "@/lib/stream-text-plain-response";
import { createClient } from "@/lib/supabase/server";
import {
  formatGenerationContextForPrompt,
  type GenerationContextV1,
} from "@/lib/generation-context";
import { runGeneratePrelude } from "@/lib/generate-prelude";
import { autoTitle } from "@/lib/utils";

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

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const PRIMARY_GENERATE_MODEL =
  process.env.OPENAI_GENERATE_MODEL?.trim() || "gpt-4o";
const FALLBACK_GENERATE_MODEL =
  process.env.OPENAI_GENERATE_FALLBACK_MODEL?.trim() || "gpt-4o-mini";

function classifyGenerateError(error: unknown): {
  retryable: boolean;
  reason: string;
} {
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 429) {
      return { retryable: true, reason: "rate_limited" };
    }
    if (typeof error.statusCode === "number" && error.statusCode >= 500) {
      return { retryable: true, reason: "provider_5xx" };
    }
    return { retryable: false, reason: `api_${error.statusCode ?? "unknown"}` };
  }
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("socket") ||
    msg.includes("econnreset")
  ) {
    return { retryable: true, reason: "transport_or_rate_limit" };
  }
  return { retryable: false, reason: "non_retryable" };
}

async function streamWithQualityFallback(opts: {
  append: (s: string) => void;
  buildResult: (modelId: string) => StreamTextResult;
}): Promise<PlainTextStreamOutcome> {
  const primaryModel = PRIMARY_GENERATE_MODEL;
  const fallbackModel = FALLBACK_GENERATE_MODEL;

  let primaryOutcome: PlainTextStreamOutcome;
  try {
    primaryOutcome = await pipeStreamTextAsPlainText(
      opts.buildResult(primaryModel),
      opts.append,
      { emitErrorHints: false },
    );
  } catch (e) {
    const cls = classifyGenerateError(e);
    const canFallback = cls.retryable && fallbackModel !== primaryModel;
    if (!canFallback) throw e;
    console.warn("[generate] primary model stream failed; retrying fallback", {
      primaryModel,
      fallbackModel,
      reason: cls.reason,
    });
    return pipeStreamTextAsPlainText(
      opts.buildResult(fallbackModel),
      opts.append,
      { emitErrorHints: true },
    );
  }

  if (primaryOutcome.sawText || primaryOutcome.emittedFailureHint) {
    return primaryOutcome;
  }

  if (fallbackModel === primaryModel) {
    return primaryOutcome;
  }

  console.warn("[generate] primary model returned no text; retrying fallback", {
    primaryModel,
    fallbackModel,
  });
  return pipeStreamTextAsPlainText(
    opts.buildResult(fallbackModel),
    opts.append,
    { emitErrorHints: true },
  );
}

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
  /** When set, `onFinish` updates this row instead of inserting. */
  generationId?: string | null;
  modelId?: string;
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
    generationId,
    modelId,
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
    (ctxBlock ? `${ctxBlock}\n\n` : "") + appendPresetToSystemPrompt(baseSystem, preset);

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
  const resolvedModelId = modelId?.trim() || PRIMARY_GENERATE_MODEL;

  const result = streamText({
    model: openai(resolvedModelId),
    maxOutputTokens: 8192,
    system: systemPrompt,
    prompt: userPrompt,
    onError({ error }) {
      console.error("[generate] streamText error:", resolvedModelId, error);
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
        const computedTitle = autoTitle(
          (sourceTextForStorage?.trim() || storedInputUrl?.trim() || ""),
        );
        if (generationId) {
          const { error } = await supabase
            .from("generations")
            .update({
              input_text: sourceTextForStorage || null,
              input_url: storedInputUrl,
              platforms: orderedPlatforms,
              output: outputToStore,
              type: rowType,
              generation_context: generationContext ?? null,
              title: computedTitle,
            })
            .eq("id", generationId)
            .eq("user_id", userId);
          if (error) {
            console.error("generations update failed", error.message);
          }
        } else {
          const { error } = await supabase.from("generations").insert({
            user_id: userId,
            input_text: sourceTextForStorage,
            input_url: storedInputUrl,
            platforms: orderedPlatforms,
            output: outputToStore,
            type: rowType,
            generation_context: generationContext ?? null,
            title: computedTitle,
          });
          if (error) {
            console.error("generations insert failed", error.message);
          }
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

  const prelude = await runGeneratePrelude(req);
  const encoder = new TextEncoder();

  const baseHeaders: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  };

  if ("fatal" in prelude) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `${GENEX_FATAL_PREFIX}${JSON.stringify(prelude.fatal)}\n`,
          ),
        );
        controller.close();
      },
    });
    return new Response(body, {
      headers: {
        ...baseHeaders,
        "x-genex-is-first-gen": "0",
        "x-genex-streak": "0",
      },
    });
  }

  const p = prelude;
  let stubGenerationId: string | null = null;
  if (p.userId) {
    const includesClipPackage = p.orderedPlatforms.includes("clip_package");
    const rowType = includesClipPackage ? "clip_package" : "generic";
    const { data: stubRow, error: stubErr } = await p.supabase
      .from("generations")
      .insert({
        user_id: p.userId,
        input_text: p.sourceTextForStorage || null,
        input_url: p.storedInputUrl,
        platforms: p.orderedPlatforms,
        output: "",
        type: rowType,
        generation_context: p.generationContext ?? null,
      })
      .select("id")
      .single();
    if (stubErr) {
      console.error("[generate] generations stub insert failed:", stubErr.message);
    } else if (stubRow?.id) {
      stubGenerationId = stubRow.id as string;
    }
  }

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const append = (s: string) => {
        if (s) controller.enqueue(encoder.encode(s));
      };
      try {
        for (const st of p.replaySteps) {
          controller.enqueue(
            encoder.encode(
              `${GENEX_STEP_PREFIX}${JSON.stringify({ id: st.id, label: st.label, ts: Date.now() })}\n`,
            ),
          );
        }

        const buildResult = (modelId: string): StreamTextResult =>
          createGenerationStreamText({
            supabase: p.supabase,
            userId: p.userId,
            sourceTextForModel: p.sourceTextForModel,
            sourceTextForStorage: p.sourceTextForStorage,
            storedInputUrl: p.storedInputUrl,
            orderedPlatforms: p.orderedPlatforms,
            preset: p.preset,
            generationContext: p.generationContext ?? null,
            generationId: stubGenerationId,
            modelId,
          });

        const outcome = await streamWithQualityFallback({ append, buildResult });
        if (!outcome.sawText && !outcome.emittedFailureHint) {
          controller.enqueue(
            encoder.encode(
              `${GENEX_FATAL_PREFIX}${JSON.stringify({
                error: "empty_output",
                message:
                  "Generation returned no content. No credits were charged. Please try again.",
              })}\n`,
            ),
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(
          encoder.encode(
            `${GENEX_FATAL_PREFIX}${JSON.stringify({ error: "exception", message: msg })}\n`,
          ),
        );
      } finally {
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });

  return new Response(body, {
    headers: {
      ...baseHeaders,
      "x-genex-is-first-gen": p.isFirstGen ? "1" : "0",
      "x-genex-streak": String(p.newStreak),
      ...(stubGenerationId
        ? { "x-genex-generation-id": stubGenerationId }
        : {}),
    },
  });
}
