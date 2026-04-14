/**
 * Detects YouTube watch / share URLs suitable for transcript lookup
 * (youtube.com/watch?v=… or youtu.be/…).
 */
export function isYoutubeVideoUrlForTranscript(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return false;
  }

  const host = u.hostname.replace(/^www\./i, "").toLowerCase();

  if (host === "youtu.be") {
    const id = u.pathname.replace(/^\//, "").split("/")[0];
    return Boolean(id?.length);
  }

  if (host === "youtube.com" || host === "m.youtube.com") {
    if (u.pathname === "/watch") {
      const v = u.searchParams.get("v");
      return Boolean(v?.trim());
    }
    return false;
  }

  return false;
}
