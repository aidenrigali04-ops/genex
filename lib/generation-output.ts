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

export function parseStoredGenerationOutput(raw: string): {
  displayOutput: string;
  platforms?: PlatformId[];
} {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredClipPackageOutputV1>;
    if (parsed?.version === 1 && typeof parsed.full === "string") {
      const platforms = Array.isArray(parsed.platforms)
        ? parsed.platforms.filter(isPlatformId)
        : undefined;
      return { displayOutput: parsed.full, platforms };
    }
  } catch {
    /* plain text */
  }
  return { displayOutput: raw };
}
