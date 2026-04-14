import type { PlatformId } from "@/lib/platforms";
import { PLATFORM_BY_ID } from "@/lib/platforms";

/**
 * Extracts body text under a platform section while streaming.
 * Headers must match those in `PLATFORM_BY_ID[id].header` exactly.
 */
export function extractPlatformSection(
  fullText: string,
  id: PlatformId,
  orderedIds: PlatformId[],
): string {
  const def = PLATFORM_BY_ID[id];
  const start = fullText.indexOf(def.header);
  if (start === -1) return "";

  let pos = start + def.header.length;
  while (pos < fullText.length && /[\r\n]/.test(fullText[pos]!)) pos++;
  while (pos < fullText.length && fullText[pos] === " ") pos++;

  const from = pos;
  let end = fullText.length;
  const idx = orderedIds.indexOf(id);
  for (let i = idx + 1; i < orderedIds.length; i++) {
    const nextHeader = PLATFORM_BY_ID[orderedIds[i]!]!.header;
    const nextAt = fullText.indexOf(nextHeader, from);
    if (nextAt !== -1) end = Math.min(end, nextAt);
  }

  return fullText.slice(from, end).replace(/\s+$/u, "");
}
