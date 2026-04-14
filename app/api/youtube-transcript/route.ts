import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { fetchYoutubeTranscriptText } from "@/lib/youtube-transcript-server";
import { isYoutubeVideoUrlForTranscript } from "@/lib/youtube-url";

const bodySchema = z.object({
  url: z.string().max(2048),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
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

  if (!isYoutubeVideoUrlForTranscript(url)) {
    return Response.json(
      {
        error:
          "Not a supported YouTube link. Use youtube.com/watch?v=… or youtu.be/…",
      },
      { status: 400 },
    );
  }

  const transcript = await fetchYoutubeTranscriptText(url);
  if (!transcript) {
    return Response.json(
      {
        error:
          "No transcript could be loaded for this video (captions may be disabled).",
      },
      { status: 422 },
    );
  }

  return Response.json({ transcript });
}
