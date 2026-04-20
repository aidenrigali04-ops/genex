import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

const EMBED_MODEL =
  process.env.OPENAI_CLIP_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";

async function embedText(text: string): Promise<number[]> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return [];
  const openai = new OpenAI({ apiKey: key });
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: text.slice(0, 8000),
  });
  const v = res.data[0]?.embedding;
  return Array.isArray(v) ? v : [];
}

export async function searchClipMemory(
  supabase: SupabaseClient,
  userId: string,
  queryText: string,
  matchCount = 5,
): Promise<string[]> {
  const embedding = await embedText(queryText);
  if (embedding.length === 0) return [];

  const { data, error } = await supabase.rpc("match_clip_embeddings", {
    query_embedding: embedding,
    match_count: matchCount,
    filter_user_id: userId,
  });

  if (error) {
    console.warn("[clip-vector-memory] match_clip_embeddings:", error.message);
    return [];
  }

  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((r: { content?: string }) => String(r?.content ?? "").trim())
    .filter(Boolean)
    .slice(0, matchCount);
}

export async function insertClipMemory(
  supabase: SupabaseClient,
  args: { userId: string; jobId: string; content: string },
): Promise<void> {
  const embedding = await embedText(args.content);
  if (embedding.length === 0) return;

  const { error } = await supabase.from("clip_embedding_memory").insert({
    user_id: args.userId,
    job_id: args.jobId,
    content: args.content.slice(0, 4000),
    embedding,
  });

  if (error) {
    console.warn("[clip-vector-memory] insert failed:", error.message);
  }
}
