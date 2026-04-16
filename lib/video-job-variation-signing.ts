import type { SupabaseClient } from "@supabase/supabase-js";

const SIGNED_URL_SECONDS = 3600;

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/** Extract object path inside bucket `videos` from a Supabase Storage URL, if present. */
function tryParseVideosObjectPathFromUrl(url: string): string | null {
  const decoded = url.trim();
  const m = decoded.match(
    /\/storage\/v1\/object\/(?:public|sign)\/videos\/([^?#]+)/i,
  );
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * Returns a time-limited signed URL for objects in the `videos` bucket when
 * `raw` is a storage path or a Supabase object URL; otherwise returns `raw`.
 */
export async function signVideoVariationPlaybackUrl(
  supabase: SupabaseClient,
  raw: string,
): Promise<string> {
  const trimmed = raw.trim();
  if (!trimmed) return raw;

  let objectPath: string | null = null;
  if (!isHttpUrl(trimmed)) {
    objectPath = trimmed.replace(/^\/+/, "");
  } else {
    objectPath = tryParseVideosObjectPathFromUrl(trimmed);
  }

  if (!objectPath) {
    if (isHttpUrl(trimmed)) {
      console.warn(
        "[video-jobs] Variation URL is not a Supabase videos object path; using as-is",
        trimmed.slice(0, 160),
      );
      return trimmed;
    }
    objectPath = trimmed.replace(/^\/+/, "");
  }

  const { data, error } = await supabase.storage
    .from("videos")
    .createSignedUrl(objectPath, SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) {
    console.warn(
      "[video-jobs] createSignedUrl failed; falling back to public URL",
      error?.message ?? "unknown",
      objectPath.slice(0, 120),
    );
    const {
      data: { publicUrl },
    } = supabase.storage.from("videos").getPublicUrl(objectPath);
    return publicUrl;
  }

  return data.signedUrl;
}

export async function signVideoJobVariationsForResponse(
  supabase: SupabaseClient,
  variations: unknown,
): Promise<unknown> {
  if (!Array.isArray(variations)) return variations;

  const out = await Promise.all(
    variations.map(async (item) => {
      if (typeof item !== "object" || item === null || !("url" in item)) {
        return item;
      }
      const rec = item as Record<string, unknown>;
      const url = rec.url;
      if (typeof url !== "string" || !url) return item;

      const signed = await signVideoVariationPlaybackUrl(supabase, url);
      return { ...rec, url: signed };
    }),
  );

  return out;
}
