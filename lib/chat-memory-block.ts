import OpenAI from "openai";
import { isTextUIPart, type UIMessage } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

const EMBED_MODEL =
  process.env.OPENAI_CLIP_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";

/** Last user-visible text from the chat thread (for embedding / memory recall). */
export function extractLastUserTextFromUiMessages(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const parts = m.parts ?? [];
    const t = parts
      .filter(isTextUIPart)
      .map((p) => p.text)
      .join("");
    const trimmed = t.trim();
    if (trimmed) return trimmed.slice(0, 1500);
  }
  return "";
}

/**
 * Builds the CREATOR MEMORY block for /api/chat system prompt.
 * Never throws; returns "" on any failure.
 */
export async function buildCreatorMemoryBlock(
  supabase: SupabaseClient,
  userId: string,
  inputContent: string,
): Promise<string> {
  try {
    const slice = inputContent.trim().slice(0, 1500);
    if (!slice) return "";

    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) return "";

    const openai = new OpenAI({ apiKey: key });

    const [vaultRes, embRes] = await Promise.all([
      supabase
        .from("clip_vault_entries")
        .select("body")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(3),
      openai.embeddings.create({
        model: EMBED_MODEL,
        input: slice,
      }),
    ]);

    const vaultSummaries = (vaultRes.data ?? [])
      .map((r: { body?: string | null }) => String(r.body ?? "").trim())
      .filter(Boolean);

    const emb = embRes.data[0]?.embedding;
    const similar: string[] = [];
    if (Array.isArray(emb) && emb.length > 0) {
      const { data: matchRows, error: rpcErr } = await supabase.rpc(
        "match_clip_embeddings",
        {
          query_embedding: emb,
          match_count: 3,
          filter_user_id: userId,
        },
      );
      if (!rpcErr && Array.isArray(matchRows)) {
        for (const r of matchRows as {
          content?: string | null;
          distance?: number | null;
        }[]) {
          const d = typeof r.distance === "number" ? r.distance : 999;
          if (d < 0.35 && r.content) {
            similar.push(String(r.content).trim().slice(0, 300));
          }
        }
      }
    }

    if (vaultSummaries.length === 0 && similar.length === 0) return "";

    const lines: string[] = [
      "=== CREATOR MEMORY (use to match voice, not to copy) ===",
      "Recent clips this creator has made:",
    ];
    if (vaultSummaries.length === 0) {
      lines.push("- (none yet)");
    } else {
      for (const v of vaultSummaries) {
        lines.push(`- ${v}`);
      }
    }
    lines.push("Past work on similar topics:");
    if (similar.length === 0) {
      lines.push("- (none closely matched)");
    } else {
      for (const s of similar) {
        lines.push(`- ${s}`);
      }
    }
    lines.push(
      "Use this memory to match their natural voice, hook style, and past patterns. Do NOT copy old hooks verbatim. Build on them.",
      "=== END MEMORY ===",
    );
    return lines.join("\n");
  } catch {
    return "";
  }
}
