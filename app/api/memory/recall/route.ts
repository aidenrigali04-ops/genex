import OpenAI from "openai";
import { z } from "zod";

import { trackAha } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const bodySchema = z.object({
  inputContent: z.string().max(2000),
});

export type MemoryRecallPayload = {
  vaultSummaries: string[];
  similarClips: string[];
};

const EMBED_MODEL =
  process.env.OPENAI_CLIP_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";

export async function POST(req: Request): Promise<Response> {
  const empty: MemoryRecallPayload = { vaultSummaries: [], similarClips: [] };

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json(
        { data: empty, error: "Unauthorized" },
        { status: 401 },
      );
    }

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return Response.json({ data: empty, error: null });
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return Response.json({ data: empty, error: null });
    }

    const inputContent = parsed.data.inputContent.slice(0, 2000).trim();
    if (!inputContent) {
      return Response.json({ data: empty, error: null });
    }

    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      return Response.json({ data: empty, error: null });
    }

    const openai = new OpenAI({ apiKey: key });

    let vaultSummaries: string[] = [];
    let embedding: number[] = [];

    try {
      const [vaultRes, embRes] = await Promise.all([
        supabase
          .from("clip_vault_entries")
          .select("body")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(3),
        openai.embeddings.create({
          model: EMBED_MODEL,
          input: inputContent,
        }),
      ]);

      vaultSummaries = (vaultRes.data ?? [])
        .map((r: { body?: string | null }) => String(r.body ?? "").trim())
        .filter(Boolean);

      const v = embRes.data[0]?.embedding;
      embedding = Array.isArray(v) ? v : [];
    } catch {
      return Response.json({ data: empty, error: null });
    }

    const similarClips: string[] = [];
    if (embedding.length > 0) {
      try {
        const { data: matchRows, error: rpcErr } = await supabase.rpc(
          "match_clip_embeddings",
          {
            query_embedding: embedding,
            match_count: 3,
            filter_user_id: user.id,
          },
        );
        if (!rpcErr && Array.isArray(matchRows)) {
          for (const r of matchRows as {
            content?: string | null;
            distance?: number | null;
          }[]) {
            const d = typeof r.distance === "number" ? r.distance : 999;
            if (d < 0.35 && r.content) {
              similarClips.push(String(r.content).trim());
            }
          }
        }
      } catch {
        /* keep similarClips empty */
      }
    }

    if (similarClips.length > 0) {
      void trackAha(supabase, user.id, "memory_recall_hit", {
        count: similarClips.length,
      });
    }

    return Response.json({
      data: { vaultSummaries, similarClips },
      error: null,
    });
  } catch {
    return Response.json({
      data: { vaultSummaries: [], similarClips: [] },
      error: null,
    });
  }
}
