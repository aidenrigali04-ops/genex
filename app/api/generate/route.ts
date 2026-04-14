import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { z } from "zod";

import { fetchUrlAsPlainText } from "@/lib/fetch-url-text";
import {
  isPlatformId,
  PLATFORM_BY_ID,
  type PlatformId,
} from "@/lib/platforms";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const SYSTEM_PROMPT = `You are an expert content strategist and copywriter. Your job is to analyze the core message, hooks, emotional triggers, and key insights from the provided content, then repurpose it into highly optimized formats for each requested platform. Use platform-specific psychology: TikTok = fast hook + story + CTA, LinkedIn = authority + insight + engagement question, Twitter = punchy + thread structure, Instagram = emotion + visual cue + hashtag strategy. Always lead with the strongest hook. Output each format clearly labeled.`;

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

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "Missing OPENAI_API_KEY in environment." },
      { status: 500 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const orderedPlatforms = normalizeOrderedPlatforms(body.platforms);

  if (orderedPlatforms.length === 0) {
    return Response.json(
      { error: "Select at least one valid platform." },
      { status: 400 },
    );
  }

  let sourceText = "";
  let storedInputUrl: string | null = null;

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

  if (!sourceText.trim()) {
    return Response.json(
      { error: "No usable text found for that input." },
      { status: 400 },
    );
  }

  const headerLines = orderedPlatforms
    .map((id) => PLATFORM_BY_ID[id].header)
    .join("\n");

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

  const result = streamText({
    model: openai("gpt-4o"),
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    onFinish: async ({ text }) => {
      const { error } = await supabase.from("generations").insert({
        user_id: user.id,
        input_text: sourceText,
        input_url: storedInputUrl,
        platforms: orderedPlatforms,
        output: text,
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
