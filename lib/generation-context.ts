import type { PlatformId } from "@/lib/platforms";
import type { ClipLengthMode } from "@/lib/clip-generation-options";

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
  /** Inferred from source excerpt during personalized refinement (optional). */
  inferredClipPurpose?: string;
  inferredPurposeRationale?: string;
  /** Source clipping: how many distinct edits to produce (1–12). */
  variationCount?: number;
  clipLengthMode?: ClipLengthMode;
  minDurationSec?: number | null;
  maxDurationSec?: number | null;
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

/** Structured imperative blocks for system / worker prompts */
export function formatGenerationContextForPrompt(raw: unknown): string {
  if (!raw) return "";
  if (!isGenerationContextV1(raw)) {
    try {
      return `User context (JSON): ${JSON.stringify(raw)}`;
    } catch {
      return "";
    }
  }
  const lines: string[] = [];
  lines.push("=== USER REQUIREMENTS — HONOR ALL OF THESE EXACTLY ===");
  if (raw.platforms.length > 0) {
    lines.push(`• Target platforms: ${raw.platforms.join(", ")}`);
  }
  const purpose = raw.inferredClipPurpose?.trim();
  if (purpose) {
    lines.push(
      `• Inferred clipping purpose (from pre-generation analysis): ${purpose}`,
    );
  }
  const rationale = raw.inferredPurposeRationale?.trim();
  if (rationale) {
    lines.push(`• Purpose rationale: ${rationale}`);
  }
  for (const [k, v] of Object.entries(raw.answers)) {
    const val = String(v).trim();
    if (!val) continue;
    const label = humanizeKey(k);
    lines.push(`• ${label}: ${val}`);
  }
  if (typeof raw.variationCount === "number" && Number.isFinite(raw.variationCount)) {
    lines.push(`• Variation count: ${raw.variationCount}`);
  }
  if (raw.clipLengthMode === "custom" || raw.clipLengthMode === "auto") {
    lines.push(`• Clip length mode: ${raw.clipLengthMode}`);
  }
  if (raw.minDurationSec != null && Number.isFinite(raw.minDurationSec)) {
    lines.push(`• Minimum clip duration (seconds): ${raw.minDurationSec}`);
  }
  if (raw.maxDurationSec != null && Number.isFinite(raw.maxDurationSec)) {
    lines.push(`• Maximum clip duration (seconds): ${raw.maxDurationSec}`);
  }
  lines.push("=== END USER REQUIREMENTS ===");
  lines.push(
    "Do NOT ignore any requirement above. Apply every constraint literally.",
  );
  return lines.join("\n");
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
  if (ctx.inferredClipPurpose?.trim()) {
    parts.push(`Purpose: ${ctx.inferredClipPurpose.trim()}`);
  }
  for (const [k, v] of Object.entries(ctx.answers)) {
    if (String(v).trim()) parts.push(`${humanizeKey(k)}: ${String(v).trim()}`);
  }
  if (typeof ctx.variationCount === "number") {
    parts.push(`Variations: ${ctx.variationCount}`);
  }
  if (ctx.clipLengthMode) {
    parts.push(`Length: ${ctx.clipLengthMode}`);
  }
  return parts.join(" — ");
}
