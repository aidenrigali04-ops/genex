import type { PlatformId } from "@/lib/platforms";

export const GENERATION_CONTEXT_VERSION = 1 as const;

export type GenerationContextV1 = {
  version: typeof GENERATION_CONTEXT_VERSION;
  /** High-level flow that produced this context */
  kind: "video_variations" | "text_generation";
  platforms: PlatformId[];
  /** Step fieldKey → user-facing answer text */
  answers: Record<string, string>;
  /** ISO timestamp when user confirmed refinement */
  confirmedAt: string;
};

export function isGenerationContextV1(v: unknown): v is GenerationContextV1 {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.version === 1 &&
    (o.kind === "video_variations" || o.kind === "text_generation") &&
    Array.isArray(o.platforms) &&
    typeof o.answers === "object" &&
    o.answers !== null &&
    typeof o.confirmedAt === "string"
  );
}

/** Single paragraph for system / worker prompts */
export function formatGenerationContextForPrompt(raw: unknown): string {
  if (!raw) return "";
  if (!isGenerationContextV1(raw)) {
    try {
      return `User context (JSON): ${JSON.stringify(raw)}`;
    } catch {
      return "";
    }
  }
  const platformLine =
    raw.platforms.length > 0
      ? `Platforms: ${raw.platforms.join(", ")}.`
      : "";
  const lines = Object.entries(raw.answers)
    .filter(([, v]) => String(v).trim().length > 0)
    .map(([k, v]) => `${humanizeKey(k)}: ${String(v).trim()}`);
  const body = [platformLine, ...lines].filter(Boolean).join(" ");
  return body.trim();
}

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^\s+/, "")
    .replace(/^./, (c) => c.toUpperCase());
}

export function buildSummaryFromContext(ctx: GenerationContextV1): string {
  const parts: string[] = [];
  if (ctx.platforms.length) {
    parts.push(ctx.platforms.join(" · "));
  }
  for (const [k, v] of Object.entries(ctx.answers)) {
    if (String(v).trim()) parts.push(`${humanizeKey(k)}: ${String(v).trim()}`);
  }
  return parts.join(" — ");
}
