export type PlatformId =
  | "twitter"
  | "linkedin"
  | "instagram"
  | "tiktok"
  | "youtube_shorts"
  | "blog"
  | "hooks"
  | "clip_package";

export type PlatformDefinition = {
  id: PlatformId;
  /** Card title */
  label: string;
  /** Exact section heading the model must emit (includes ###) */
  header: string;
};

export const PLATFORM_DEFS: readonly PlatformDefinition[] = [
  {
    id: "twitter",
    label: "Twitter/X Thread",
    header: "### Twitter/X Thread",
  },
  {
    id: "linkedin",
    label: "LinkedIn Post",
    header: "### LinkedIn Post",
  },
  {
    id: "instagram",
    label: "Instagram Caption",
    header: "### Instagram Caption",
  },
  {
    id: "tiktok",
    label: "TikTok Script",
    header: "### TikTok Script",
  },
  {
    id: "youtube_shorts",
    label: "YouTube Shorts Script",
    header: "### YouTube Shorts Script",
  },
  {
    id: "blog",
    label: "Blog Article",
    header: "### Blog Article",
  },
  {
    id: "hooks",
    label: "Hook Variations (10x)",
    header: "### Hook Variations (10x)",
  },
  {
    id: "clip_package",
    label: "Short-Form Clip Package (TikTok / Reels / Shorts)",
    header: "### Short-Form Clip Package (TikTok / Reels / Shorts)",
  },
] as const;

export const PLATFORM_IDS: PlatformId[] = PLATFORM_DEFS.map((p) => p.id);

export const PLATFORM_BY_ID = Object.fromEntries(
  PLATFORM_DEFS.map((p) => [p.id, p]),
) as Record<PlatformId, PlatformDefinition>;

export function isPlatformId(value: string): value is PlatformId {
  return PLATFORM_IDS.includes(value as PlatformId);
}
