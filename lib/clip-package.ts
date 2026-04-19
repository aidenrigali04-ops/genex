export type ClipSection = {
  id:
    | "moments"
    | "hooks"
    | "script"
    | "cta"
    | "caption_hashtags"
    | "broll"
    | "creator_signals";
  label: string;
  patterns: RegExp[];
};

export type ClipInputMode = "clip_first" | "generate_first";

export const CLIP_SECTIONS: readonly ClipSection[] = [
  {
    id: "moments",
    label: "Top Clip Moments",
    patterns: [/^\s*(?:\d+\.\s*)?TOP CLIP MOMENTS\b/im],
  },
  {
    id: "hooks",
    label: "Hook Options",
    patterns: [/^\s*(?:\d+\.\s*)?HOOK\s*\(FIRST 3 SECONDS\)\b/im],
  },
  {
    id: "script",
    label: "Clip Script",
    patterns: [
      // Prompt asks for: "3. CLIP SCRIPT (30–60 SECONDS)" — allow en-dash, hyphen, ranges
      /^\s*(?:\d+\.\s*)?CLIP SCRIPT\s*\(\s*30[\s–\-—~]*\d*\s*SECONDS?\s*\)/im,
      /^\s*(?:\d+\.\s*)?CLIP SCRIPT\s*\([^)\n]*SECONDS?[^)\n]*\)/im,
      /^\s*(?:\d+\.\s*)?CLIP SCRIPT\b/im,
    ],
  },
  {
    id: "cta",
    label: "CTA Variations",
    patterns: [/^\s*(?:\d+\.\s*)?CTA\s*\(CALL TO ACTION\)\b/im],
  },
  {
    id: "caption_hashtags",
    label: "Caption + Hashtags",
    patterns: [/^\s*(?:\d+\.\s*)?CAPTION HOOK \+ HASHTAGS\b/im],
  },
  {
    id: "broll",
    label: "B-roll / Visual Ideas",
    patterns: [/^\s*(?:\d+\.\s*)?B-ROLL \/ VISUAL IDEAS\b/im],
  },
  {
    id: "creator_signals",
    label: "Format tags & length hint",
    patterns: [/^\s*(?:7\.\s*)?CREATOR SIGNALS\b/im],
  },
] as const;

export function getOrderedSections(
  mode: ClipInputMode,
): readonly ClipSection[] {
  if (mode === "clip_first") {
    const order: ClipSection["id"][] = [
      "moments",
      "hooks",
      "script",
      "cta",
      "caption_hashtags",
      "broll",
      "creator_signals",
    ];
    return order
      .map((id) => CLIP_SECTIONS.find((s) => s.id === id))
      .filter((s): s is ClipSection => Boolean(s));
  }
  const order: ClipSection["id"][] = [
    "hooks",
    "script",
    "cta",
    "caption_hashtags",
    "broll",
    "creator_signals",
    "moments",
  ];
  return order
    .map((id) => CLIP_SECTIONS.find((s) => s.id === id))
    .filter((s): s is ClipSection => Boolean(s));
}

export type HookStrength = "high" | "strong" | "solid";

export interface HookStrengthResult {
  strength: HookStrength;
  /** One short phrase e.g. "Pattern interrupt + curiosity gap" */
  reason: string;
}

/**
 * Parse HOOK_STRENGTH from creator_signals block if present.
 * Example: `HOOK_STRENGTH: high | Reason: Pattern interrupt + curiosity gap`
 */
export function parseHookStrength(
  creatorSignalsBlock: string,
): HookStrengthResult | null {
  if (!creatorSignalsBlock?.trim()) return null;

  const strengthLine = creatorSignalsBlock
    .split(/\r?\n/)
    .find((l) => /HOOK_STRENGTH:/i.test(l));
  if (!strengthLine) return null;

  const match = strengthLine.match(
    /HOOK_STRENGTH:\s*(high|strong|solid)\b(?:\s*[|]\s*(?:Reason:\s*)?(.+))?/i,
  );
  if (!match?.[1]) return null;

  const raw = match[1].toLowerCase();
  if (raw !== "high" && raw !== "strong" && raw !== "solid") return null;

  const strength = raw as HookStrength;
  const reason = (match[2] ?? "").trim();
  return { strength, reason };
}

export type ClipSectionMap = Record<ClipSection["id"], string>;

function findSectionStart(body: string, section: ClipSection): number {
  for (const pattern of section.patterns) {
    const m = pattern.exec(body);
    if (m?.index !== undefined) return m.index;
  }
  return -1;
}

export function parseClipPackageSections(body: string): ClipSectionMap {
  const starts = CLIP_SECTIONS.map((section) => ({
    section,
    index: findSectionStart(body, section),
  })).filter((item) => item.index >= 0);

  const sorted = starts.sort((a, b) => a.index - b.index);
  const out: ClipSectionMap = {
    moments: "",
    hooks: "",
    script: "",
    cta: "",
    caption_hashtags: "",
    broll: "",
    creator_signals: "",
  };

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    if (!current) continue;
    const next = sorted[i + 1];
    const from = current.index;
    const to = next ? next.index : body.length;
    const chunk = body.slice(from, to).trim();
    out[current.section.id] = chunk;
  }

  return out;
}

/** Strip heading / preamble so metrics only count real script beats. */
export function extractScriptBodyForMetrics(scriptChunk: string): string {
  const cueOrLine = scriptChunk.search(/\[VISUAL CUE\]|\[LINE\]/i);
  if (cueOrLine === -1) return scriptChunk;
  return scriptChunk.slice(cueOrLine);
}

/** Count words in [LINE]: spoken parts only (ignores [VISUAL CUE] lines). */
export function countSpokenWordsInScript(scriptChunk: string): number {
  const body = extractScriptBodyForMetrics(scriptChunk);
  const lines = body.split(/\r?\n/);
  let words = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t || /^\[VISUAL CUE\]/i.test(t)) continue;
    const m = t.match(/^\[LINE\]\s*:\s*(.*)$/i);
    const spoken = m ? m[1]!.trim() : t.replace(/^\[LINE\]\s*/i, "").trim();
    if (!spoken) continue;
    words += spoken.split(/\s+/).filter(Boolean).length;
  }
  return words;
}

/** ~140 wpm spoken = ~2.33 words/sec; clamp to realistic Shorts window. */
export function estimateClipDurationSeconds(scriptChunk: string): {
  seconds: number;
  wordCount: number;
} {
  const wordCount = countSpokenWordsInScript(scriptChunk);
  if (wordCount === 0) {
    return { seconds: 0, wordCount: 0 };
  }
  const raw = Math.round(wordCount / 2.33);
  const seconds = Math.min(70, Math.max(28, raw));
  return { seconds, wordCount };
}

export function parseFormatTagsFromCreatorSignals(block: string): string[] {
  if (!block.trim()) return [];
  const line = block.split(/\r?\n/).find((l) => /FORMAT_TAGS:/i.test(l));
  if (!line) return [];
  const value = line.replace(/^.*FORMAT_TAGS:\s*/i, "").trim();
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * Parses FORMAT_TAGS from a creator_signals section (alias of
 * {@link parseFormatTagsFromCreatorSignals}).
 */
export function parseFormatTags(creatorSignalsText: string): string[] {
  return parseFormatTagsFromCreatorSignals(creatorSignalsText);
}

/** High / medium / low — for output panel hook signal (distinct from {@link HookStrength}). */
export type HookStrengthSignalLevel = "high" | "medium" | "low";

export type HookStrengthSignal = {
  level: HookStrengthSignalLevel;
  reason: string;
};

/**
 * Parses HOOK_STRENGTH from creator_signals for UI (high | medium | low).
 * Falls back to legacy {@link parseHookStrength} (high | strong | solid) and maps
 * strong → medium, solid → low.
 */
export function parseHookStrengthSignal(
  creatorSignalsText: string,
): HookStrengthSignal | null {
  if (!creatorSignalsText?.trim()) return null;

  const strengthLine = creatorSignalsText
    .split(/\r?\n/)
    .find((l) => /HOOK_STRENGTH:/i.test(l));
  if (!strengthLine) return null;

  const modern = strengthLine.match(
    /HOOK_STRENGTH:\s*(high|medium|low)\b(?:\s*[|]\s*(?:Reason:\s*)?(.+))?/i,
  );
  if (modern?.[1]) {
    const raw = modern[1].toLowerCase();
    if (raw === "high" || raw === "medium" || raw === "low") {
      return {
        level: raw as HookStrengthSignalLevel,
        reason: (modern[2] ?? "").trim(),
      };
    }
  }

  const legacy = parseHookStrength(creatorSignalsText);
  if (!legacy) return null;
  const level: HookStrengthSignalLevel =
    legacy.strength === "high"
      ? "high"
      : legacy.strength === "strong"
        ? "medium"
        : "low";
  return { level, reason: legacy.reason };
}

export function parseLengthHintSeconds(block: string): number | null {
  if (!block.trim()) return null;
  const line = block
    .split(/\r?\n/)
    .find((l) => /LENGTH_HINT_SECONDS:/i.test(l));
  if (!line) return null;
  const m = line.match(/LENGTH_HINT_SECONDS:\s*(\d+)/i);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  if (Number.isNaN(n) || n < 22 || n > 75) return null;
  return n;
}

export function deriveClipTitle(clipOutput: string, fallback: string): string {
  const parsed = parseClipPackageSections(clipOutput);
  const hooks = parsed.hooks.replace(/\s+/g, " ").trim();
  if (hooks) {
    const withoutHeading = hooks
      .replace(/^\s*(?:\d+\.\s*)?HOOK\s*\(FIRST 3 SECONDS\)\s*/i, "")
      .replace(/^[-*0-9.\s]+/, "")
      .trim();
    if (withoutHeading) {
      return withoutHeading.slice(0, 80);
    }
  }
  return fallback.slice(0, 80);
}
