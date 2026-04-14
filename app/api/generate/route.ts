import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { z } from "zod";

import { parseClipPackageSections } from "@/lib/clip-package";
import { fetchUrlAsPlainText } from "@/lib/fetch-url-text";
import type { StoredClipPackageOutputV1 } from "@/lib/generation-output";
import {
  isPlatformId,
  PLATFORM_BY_ID,
  type PlatformId,
} from "@/lib/platforms";
import { extractPlatformSection } from "@/lib/parse-generation-output";
import { sourceFromUpload } from "@/lib/source-from-upload";
import { createClient } from "@/lib/supabase/server";

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
  platforms: z.array(z.string()).min(1),
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
  userId: string;
  sourceText: string;
  storedInputUrl: string | null;
  orderedPlatforms: PlatformId[];
}) {
  const { supabase, userId, sourceText, storedInputUrl, orderedPlatforms } =
    opts;

  const headerLines = orderedPlatforms
    .map((id) => PLATFORM_BY_ID[id].header)
    .join("\n");
  const includesClipPackage = orderedPlatforms.includes("clip_package");
  const systemPrompt = includesClipPackage
    ? CLIP_PACKAGE_SYSTEM_PROMPT
    : GENERIC_SYSTEM_PROMPT;

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
${sourceText}
---`;

  /** `onFinish` `text` can be empty in edge cases; deltas are authoritative. */
  let streamedTextBuffer = "";

  const result = streamText({
    model: openai("gpt-4o"),
    system: systemPrompt,
    prompt: userPrompt,
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

      const { error } = await supabase.from("generations").insert({
        user_id: userId,
        input_text: sourceText,
        input_url: storedInputUrl,
        platforms: orderedPlatforms,
        output: outputToStore,
        type: rowType,
      });
      if (error) {
        console.error("generations insert failed", error.message);
      }
    },
  });

  return result.toTextStreamResponse({
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
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

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  let sourceText = "";
  let storedInputUrl: string | null = null;
  let orderedPlatforms: PlatformId[] = [];

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
    } else {
      const u = body.url?.trim() ?? "";
      if (!u) {
        return Response.json({ error: "URL is required." }, { status: 400 });
      }
      try {
        sourceText = await fetchUrlAsPlainText(u);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not read URL";
        return Response.json({ error: msg }, { status: 400 });
      }
      storedInputUrl = u;
    }
  }

  if (!sourceText.trim()) {
    return Response.json(
      { error: "No usable text found for that input." },
      { status: 400 },
    );
  }

  return streamGenerationResponse({
    supabase,
    userId,
    sourceText,
    storedInputUrl,
    orderedPlatforms,
  });
}
