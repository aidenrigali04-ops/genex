import { YoutubeTranscript } from "youtube-transcript";

import { isYoutubeVideoUrlForTranscript } from "@/lib/youtube-url";

/** Returns joined caption text, or null if unavailable / error. */
export async function fetchYoutubeTranscriptText(
  pageUrl: string,
): Promise<string | null> {
  const url = pageUrl.trim();
  if (!isYoutubeVideoUrlForTranscript(url)) return null;

  try {
    const parts = await YoutubeTranscript.fetchTranscript(url);
    const text = parts
      .map((p) => p.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}
