/** Shared clip / text-video generation limits (source clipping + stock assembly). */

export const DEFAULT_VARIATION_COUNT = 3;
export const MIN_VARIATION_COUNT = 1;
export const MAX_VARIATION_COUNT = 12;

export type ClipLengthMode = "auto" | "custom";

export function normalizeVariationCount(input?: number | null): number {
  if (typeof input !== "number" || Number.isNaN(input)) {
    return DEFAULT_VARIATION_COUNT;
  }
  return Math.min(
    MAX_VARIATION_COUNT,
    Math.max(MIN_VARIATION_COUNT, Math.floor(input)),
  );
}

export function validateDurationOptions(input: {
  clipLengthMode?: ClipLengthMode;
  minDurationSec?: number | null;
  maxDurationSec?: number | null;
}): { ok: true } | { ok: false; message: string } {
  if (input.clipLengthMode !== "custom") return { ok: true };

  const min = input.minDurationSec;
  const max = input.maxDurationSec;

  if (min != null && (!Number.isFinite(min) || min <= 0)) {
    return {
      ok: false,
      message: "Minimum duration must be a positive number.",
    };
  }

  if (max != null && (!Number.isFinite(max) || max <= 0)) {
    return {
      ok: false,
      message: "Maximum duration must be a positive number.",
    };
  }

  if (min != null && max != null && min > max) {
    return {
      ok: false,
      message: "Minimum duration cannot be greater than maximum duration.",
    };
  }

  return { ok: true };
}

/** Planner shot-count + total runtime guidance for text→video (soft targets, not hard rejects). */
export function textVideoPlannerHintsFromPayload(input: {
  variationCount?: number | null;
  clipLengthMode?: ClipLengthMode;
  minDurationSec?: number | null;
  maxDurationSec?: number | null;
}): {
  minShots: number;
  maxShots: number;
  totalMinSec: number;
  totalMaxSec: number;
} {
  const v = normalizeVariationCount(input.variationCount);
  const minShots = Math.max(3, Math.min(12, v + 2));
  const maxShots = Math.min(12, Math.max(minShots + 1, v + 5));

  let totalMinSec = 14;
  let totalMaxSec = 120;

  if (input.clipLengthMode === "custom") {
    const min = input.minDurationSec;
    const max = input.maxDurationSec;
    if (min != null && Number.isFinite(min) && min > 0) {
      totalMinSec = Math.max(6, min * 0.88);
    }
    if (max != null && Number.isFinite(max) && max > 0) {
      totalMaxSec = Math.min(180, max * 1.12);
    }
    if (totalMaxSec < totalMinSec + 4) {
      totalMaxSec = totalMinSec + 8;
    }
  }

  return { minShots, maxShots, totalMinSec, totalMaxSec };
}
