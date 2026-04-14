import type { ClipSectionMap } from "@/lib/clip-package";
import type { PlatformId } from "@/lib/platforms";
import { isPlatformId } from "@/lib/platforms";

export type StoredClipPackageOutputV1 = {
  version: 1;
  full: string;
  clipPackageMarkdown: string;
  clipSections: ClipSectionMap;
  platforms: PlatformId[];
};

function clipBodyFromStoredSections(
  sections: Partial<ClipSectionMap> | undefined,
): string {
  if (!sections || typeof sections !== "object") return "";
  const keys: (keyof ClipSectionMap)[] = [
    "moments",
    "hooks",
    "script",
    "cta",
    "caption_hashtags",
    "broll",
    "creator_signals",
  ];
  const parts = keys
    .map((k) => {
      const v = sections[k];
      return typeof v === "string" ? v.trim() : "";
    })
    .filter(Boolean);
  return parts.join("\n\n");
}

export function parseStoredGenerationOutput(raw: string): {
  displayOutput: string;
  platforms?: PlatformId[];
} {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredClipPackageOutputV1>;
    if (parsed?.version === 1) {
      const full =
        typeof parsed.full === "string" ? parsed.full.trim() : "";
      const md =
        typeof parsed.clipPackageMarkdown === "string"
          ? parsed.clipPackageMarkdown.trim()
          : "";
      const fromSections = clipBodyFromStoredSections(parsed.clipSections);
      const merged = full || md || fromSections;
      /** Never surface raw JSON when the stored payload has no real clip text. */
      const displayOutput = merged.trim() ? merged : "";
      const platforms = Array.isArray(parsed.platforms)
        ? parsed.platforms.filter(isPlatformId)
        : undefined;
      return { displayOutput, platforms };
    }
  } catch {
    /* plain text */
  }
  return { displayOutput: raw };
}

/** True when `raw` is a v1 clip JSON shell with no usable markdown or sections. */
export function isEmptyStoredClipPackageV1(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredClipPackageOutputV1>;
    if (parsed?.version !== 1) return false;
    const full =
      typeof parsed.full === "string" ? parsed.full.trim() : "";
    const md =
      typeof parsed.clipPackageMarkdown === "string"
        ? parsed.clipPackageMarkdown.trim()
        : "";
    const fromSections = clipBodyFromStoredSections(parsed.clipSections);
    return !full && !md && !fromSections;
  } catch {
    return false;
  }
}
