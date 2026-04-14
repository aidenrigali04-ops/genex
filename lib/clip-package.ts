export type ClipSection = {
  id:
    | "moments"
    | "hooks"
    | "script"
    | "cta"
    | "caption_hashtags"
    | "broll";
  label: string;
  patterns: RegExp[];
};

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
    patterns: [/^\s*(?:\d+\.\s*)?CLIP SCRIPT\s*\(30[^\n]*SECONDS\)\b/im],
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
] as const;

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
