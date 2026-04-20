import { z } from "zod";

const youtubeOembed = z.object({
  url: z.string().url(),
});

export type ClipToolName = "youtube_oembed" | "noop_memory_search";

export const CLIP_TOOL_DEFINITIONS = [
  {
    name: "youtube_oembed" as const,
    description:
      "Fetch public oEmbed metadata (title, thumbnail) for a YouTube watch URL when grounding clip intent.",
    parameters: youtubeOembed,
  },
  {
    name: "noop_memory_search" as const,
    description:
      "Placeholder for future vector memory search from the model; server already injects retrieval.",
    parameters: z.object({ query: z.string().max(500) }),
  },
];

export type ClipToolResult = { ok: true; text: string } | { ok: false; error: string };

export async function executeClipTool(
  name: ClipToolName,
  rawArgs: unknown,
): Promise<ClipToolResult> {
  try {
    if (name === "noop_memory_search") {
      return {
        ok: true,
        text: "Vector retrieval is applied server-side for this request; no additional tool fetch.",
      };
    }
    if (name === "youtube_oembed") {
      const args = youtubeOembed.parse(rawArgs);
      const u = new URL(args.url);
      if (!/youtube\.com|youtu\.be/i.test(u.hostname)) {
        return { ok: false, error: "URL is not a YouTube domain." };
      }
      const oembed = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(args.url)}`;
      const res = await fetch(oembed, { next: { revalidate: 0 } });
      if (!res.ok) {
        return { ok: false, error: `oEmbed HTTP ${res.status}` };
      }
      const j = (await res.json()) as { title?: string; author_name?: string };
      return {
        ok: true,
        text: `YouTube oEmbed: title=${JSON.stringify(j.title ?? "")} author=${JSON.stringify(j.author_name ?? "")}`,
      };
    }
    return { ok: false, error: `Unknown tool: ${name}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** Build a compact block for the planner from tool results (bounded). */
export function formatToolContextForPlanner(results: string[]): string {
  if (results.length === 0) return "";
  const block = ["--- Tool registry (grounding) ---", ...results].join("\n");
  return block.length > 1200 ? `${block.slice(0, 1197)}...` : block;
}

const YT =
  /https?:\/\/(www\.)?(youtube\.com\/watch\?v=[\w-]+|youtu\.be\/[\w-]+)/gi;

export async function runClipToolsForScript(script: string): Promise<string[]> {
  const out: string[] = [];
  const urls = [...script.matchAll(YT)].map((m) => m[0]);
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const r = await executeClipTool("youtube_oembed", { url });
    if (r.ok) out.push(r.text);
    else out.push(`youtube_oembed failed: ${r.error}`);
    if (out.length >= 3) break;
  }
  const mem = await executeClipTool("noop_memory_search", {
    query: script.slice(0, 200),
  });
  if (mem.ok) out.push(mem.text);
  return out;
}
