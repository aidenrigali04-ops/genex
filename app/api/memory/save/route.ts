import OpenAI from "openai";
import { z } from "zod";

import { trackAha } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const bodySchema = z.object({
  generationId: z.string().min(1),
  outputText: z.string().min(1),
  inputContent: z.string().max(4000).optional(),
  platforms: z.array(z.string()).default([]),
  detectedPurpose: z.string().max(120).optional(),
});

const EMBED_MODEL =
  process.env.OPENAI_CLIP_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";

function firstHookLine(outputText: string): string {
  const m = outputText.match(/\[hooks?\]([\s\S]*?)\[\/hooks?\]/i);
  if (!m?.[1]) return "";
  const inner = m[1];
  const line = inner
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ?? "";
}

function stripTitleMarkdown(s: string): string {
  return s
    .replace(/[#*_`[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: Request): Promise<Response> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json(
        { data: null, error: "Unauthorized" },
        { status: 401 },
      );
    }

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return Response.json(
        { data: null, error: "Save failed" },
        { status: 500 },
      );
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { data: null, error: "Save failed" },
        { status: 500 },
      );
    }

    const { generationId, outputText, platforms, detectedPurpose } =
      parsed.data;
    const inputSnippet = (parsed.data.inputContent ?? "").slice(0, 200);

    if (outputText.trim().length <= 50) {
      return Response.json(
        { data: null, error: "outputText must be longer than 50 characters" },
        { status: 400 },
      );
    }

    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      return Response.json(
        { data: null, error: "Save failed" },
        { status: 500 },
      );
    }

    const openai = new OpenAI({ apiKey: key });
    const embedInput = outputText.slice(0, 1500);
    const embRes = await openai.embeddings.create({
      model: EMBED_MODEL,
      input: embedInput,
    });
    const embedding = embRes.data[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return Response.json(
        { data: null, error: "Save failed" },
        { status: 500 },
      );
    }

    const metadata = {
      platforms,
      purpose: detectedPurpose ?? null,
      inputSnippet,
    };

    const { error: memErr } = await supabase.from("clip_embedding_memory").insert({
      user_id: user.id,
      generation_id: generationId,
      content: embedInput,
      embedding,
      metadata,
    });
    if (memErr) {
      console.error("[memory/save] clip_embedding_memory", memErr.message);
      return Response.json(
        { data: null, error: "Save failed" },
        { status: 500 },
      );
    }

    const firstHook = firstHookLine(outputText);
    const vaultParts: string[] = [];
    if (firstHook) vaultParts.push(firstHook);
    if (platforms.length) {
      vaultParts.push(` · Platform: ${platforms.join(", ")}`);
    }
    if (detectedPurpose?.trim()) {
      vaultParts.push(` · Purpose: ${detectedPurpose.trim()}`);
    }
    const vaultBody = vaultParts.join("").trim() || outputText.slice(0, 200);

    const { error: vaultErr } = await supabase.from("clip_vault_entries").insert({
      user_id: user.id,
      body: vaultBody,
    });
    if (vaultErr) {
      console.error("[memory/save] clip_vault_entries", vaultErr.message);
      return Response.json(
        { data: null, error: "Save failed" },
        { status: 500 },
      );
    }

    if (firstHook) {
      const title = stripTitleMarkdown(firstHook).slice(0, 60);
      if (title) {
        const { data: patchRows, error: patchErr } = await supabase
          .from("generations")
          .update({ title })
          .eq("id", generationId)
          .eq("user_id", user.id)
          .is("title", null)
          .select("id");
        if (!patchErr && patchRows && patchRows.length > 0) {
          void trackAha(supabase, user.id, "generation_titled", {
            generationId,
          });
        }
      }
    }

    return Response.json({
      data: { ok: true as const },
      error: null,
    });
  } catch (e) {
    console.error("[memory/save]", e);
    return Response.json(
      { data: null, error: "Save failed" },
      { status: 500 },
    );
  }
}
