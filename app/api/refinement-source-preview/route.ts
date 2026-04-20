import { z } from "zod";

import { fetchUrlAsPlainText } from "@/lib/fetch-url-text";
import { isYoutubeVideoUrlForTranscript } from "@/lib/youtube-url";

export const maxDuration = 30;

const PREVIEW_MAX_CHARS = 8_000;

const bodySchema = z.object({
  url: z.string().max(2048),
});

export async function POST(req: Request) {
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

  const url = parsed.data.url.trim();
  let asUrl: URL;
  try {
    asUrl = new URL(url);
  } catch {
    return Response.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(asUrl.protocol)) {
    return Response.json({ error: "URL must be http(s)" }, { status: 400 });
  }

  if (isYoutubeVideoUrlForTranscript(url)) {
    return Response.json(
      {
        error: "youtube_use_transcript_endpoint",
        message: "Use /api/youtube-transcript for YouTube URLs.",
      },
      { status: 400 },
    );
  }

  try {
    const plain = await fetchUrlAsPlainText(url);
    const excerpt = plain.trim().slice(0, PREVIEW_MAX_CHARS);
    return Response.json({
      excerpt,
      truncated: plain.trim().length > PREVIEW_MAX_CHARS,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not fetch URL";
    return Response.json({ error: "fetch_failed", message: msg }, { status: 422 });
  }
}
