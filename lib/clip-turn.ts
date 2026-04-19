import type { ClipSectionMap } from "@/lib/clip-package";
import type { GenerationContextV1 } from "@/lib/generation-context";
import type { GenerationPresetId } from "@/lib/generation-presets";

export type ClipTurn = {
  id: string;
  userMessage: string;
  inputMode: "text" | "url" | "file";
  preset: GenerationPresetId | null;
  timestamp: Date;
  parsedClipPackage: ClipSectionMap;
  rawText: string;
  generationId: string | null;
  generationContext: GenerationContextV1 | null;
};

export type LiveClipTurnSnapshot = {
  userMessage: string;
  inputMode: "text" | "url" | "file";
  preset: GenerationPresetId | null;
};

export function buildUserMessageSummary(
  text: string,
  url: string,
  file: File | null,
  mode: "text" | "url" | "file",
): string {
  if (mode === "url") return url.trim();
  if (mode === "file") return file?.name ?? "Uploaded file";
  const t = text.trim();
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}
