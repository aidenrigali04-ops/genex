import type { PlatformId } from "@/lib/platforms";

export type RefinementKind = "video_variations" | "text_generation";

export type RefinementStepDef = {
  id: string;
  /** Shown as AI bubble */
  message: string;
  fieldKey: string;
  pills: { label: string; value: string }[];
  /** When true, show text field after pills (e.g. Custom) */
  allowCustom: boolean;
};

const SHORT_VERTICAL_IDS: PlatformId[] = [
  "tiktok",
  "youtube_shorts",
  "instagram",
  "clip_package",
];

function wantsShortFormQuestions(platformIds: PlatformId[]): boolean {
  if (platformIds.length === 0) return true;
  return platformIds.some((p) => SHORT_VERTICAL_IDS.includes(p));
}

function wantsLinkedIn(platformIds: PlatformId[]): boolean {
  return platformIds.includes("linkedin");
}

function wantsTwitter(platformIds: PlatformId[]): boolean {
  return platformIds.includes("twitter");
}

function wantsBlog(platformIds: PlatformId[]): boolean {
  return platformIds.includes("blog");
}

/** Max 3 question steps before summary (per product spec). */
export function buildRefinementSteps(
  kind: RefinementKind,
  platformIds: PlatformId[],
): RefinementStepDef[] {
  if (kind === "video_variations") {
    return [
      {
        id: "length",
        message:
          "Rough target length for each cut? (We still respect your source footage.)",
        fieldKey: "targetLength",
        pills: [
          { label: "15s", value: "~15 seconds per variation" },
          { label: "30s", value: "~30 seconds per variation" },
          { label: "60s", value: "~60 seconds per variation" },
          { label: "90s", value: "~90 seconds per variation" },
          { label: "Custom", value: "__custom__" },
        ],
        allowCustom: true,
      },
      {
        id: "goal",
        message: "What is the main goal for these clips?",
        fieldKey: "goal",
        pills: [
          { label: "Get followers", value: "Grow followers / audience" },
          { label: "Promote something", value: "Promote a product, drop, or channel" },
          { label: "Entertainment", value: "Pure entertainment / storytelling" },
          { label: "Link in bio", value: "Drive traffic to link in bio" },
          { label: "Custom", value: "__custom__" },
        ],
        allowCustom: true,
      },
      {
        id: "delivery",
        message: "Voiceover, captions on screen, or both?",
        fieldKey: "voiceoverCaptions",
        pills: [
          { label: "Voiceover", value: "Prefer voiceover-led edits" },
          { label: "Captions only", value: "Captions on screen, minimal VO" },
          { label: "Both", value: "Mix of voiceover and bold captions" },
          { label: "Custom", value: "__custom__" },
        ],
        allowCustom: true,
      },
    ];
  }

  if (wantsShortFormQuestions(platformIds)) {
    return [
      {
        id: "length",
        message:
          "Target vibe for clip length? (TikTok / Reels / Shorts package — approximate)",
        fieldKey: "targetLength",
        pills: [
          { label: "15s", value: "~15s clips" },
          { label: "30s", value: "~30s clips" },
          { label: "60s", value: "~60s clips" },
          { label: "90s", value: "~90s clips" },
          { label: "Custom", value: "__custom__" },
        ],
        allowCustom: true,
      },
      {
        id: "goal",
        message: "What is the ONE outcome you want from this package?",
        fieldKey: "primaryOutcome",
        pills: [
          { label: "Followers", value: "Maximize follows / shares" },
          { label: "Promote", value: "Promote something specific" },
          { label: "Educate", value: "Teach or explain clearly" },
          { label: "Entertain", value: "Entertain / story" },
          { label: "Custom", value: "__custom__" },
        ],
        allowCustom: true,
      },
      {
        id: "niche",
        message: "What niche or account theme should the voice match?",
        fieldKey: "niche",
        pills: [
          { label: "Faith / values", value: "Faith-forward or values-led" },
          { label: "Fitness", value: "Fitness / health" },
          { label: "Travel", value: "Travel / lifestyle" },
          { label: "Comedy", value: "Comedy / personality-forward" },
          { label: "Custom", value: "__custom__" },
        ],
        allowCustom: true,
      },
    ];
  }

  if (wantsLinkedIn(platformIds)) {
    return [
      {
        id: "li_position",
        message: "How should this read on LinkedIn?",
        fieldKey: "linkedinPositioning",
        pills: [
          { label: "Founder", value: "Position as founder" },
          { label: "Expert", value: "Position as subject-matter expert" },
          { label: "Personal brand", value: "Personal brand / authentic voice" },
          { label: "Custom", value: "__custom__" },
        ],
        allowCustom: true,
      },
      {
        id: "li_format",
        message: "Preferred post shape?",
        fieldKey: "linkedinFormat",
        pills: [
          { label: "Story", value: "Story-led post" },
          { label: "Insight", value: "Insight / framework post" },
          { label: "Opinion", value: "Opinion / spicy take" },
          { label: "Custom", value: "__custom__" },
        ],
        allowCustom: true,
      },
      {
        id: "outcome",
        message: "What should the reader do or feel after reading?",
        fieldKey: "primaryOutcome",
        pills: [
          { label: "Comment", value: "Spark comments" },
          { label: "DMs", value: "Encourage DMs / conversations" },
          { label: "Apply idea", value: "Apply a tactic this week" },
          { label: "Custom", value: "__custom__" },
        ],
        allowCustom: true,
      },
    ];
  }

  if (wantsTwitter(platformIds)) {
    return [
      {
        id: "tw_len",
        message: "Rough thread length?",
        fieldKey: "threadLength",
        pills: [
          { label: "~5 tweets", value: "About 5 tweets" },
          { label: "~10 tweets", value: "About 10 tweets" },
          { label: "15+", value: "15 or more tweets" },
          { label: "Custom", value: "__custom__" },
        ],
        allowCustom: true,
      },
      {
        id: "tw_tone",
        message: "Tone for the thread?",
        fieldKey: "threadTone",
        pills: [
          { label: "Professional", value: "Professional" },
          { label: "Casual", value: "Casual / conversational" },
          { label: "Bold", value: "Bold / contrarian" },
          { label: "Custom", value: "__custom__" },
        ],
        allowCustom: true,
      },
      {
        id: "outcome",
        message: "What is the ONE thing you want readers to do or feel?",
        fieldKey: "primaryOutcome",
        pills: [
          { label: "Retweet", value: "Drive retweets" },
          { label: "Follow", value: "Drive follows" },
          { label: "Click", value: "Drive link clicks" },
          { label: "Custom", value: "__custom__" },
        ],
        allowCustom: true,
      },
    ];
  }

  if (wantsBlog(platformIds)) {
    return [
      {
        id: "blog_len",
        message: "Target length for the long-form piece?",
        fieldKey: "targetLength",
        pills: [
          { label: "~5 min read", value: "About a 5 minute read" },
          { label: "~10 min read", value: "About a 10 minute read" },
          { label: "Long-form", value: "Deep long-form article" },
          { label: "Custom", value: "__custom__" },
        ],
        allowCustom: true,
      },
      {
        id: "blog_audience",
        message: "Who is the target audience?",
        fieldKey: "audience",
        pills: [
          { label: "Beginners", value: "Beginners" },
          { label: "Practitioners", value: "Practitioners / operators" },
          { label: "Executives", value: "Executives / decision-makers" },
          { label: "Custom", value: "__custom__" },
        ],
        allowCustom: true,
      },
      {
        id: "blog_cta",
        message: "What action should readers take after?",
        fieldKey: "callToAction",
        pills: [
          { label: "Subscribe", value: "Subscribe / follow" },
          { label: "Try tactic", value: "Try a tactic this week" },
          { label: "Share", value: "Share with a teammate" },
          { label: "Custom", value: "__custom__" },
        ],
        allowCustom: true,
      },
    ];
  }

  return [
    {
      id: "outcome",
      message:
        "What is the ONE thing you want the audience to feel or do after seeing this?",
      fieldKey: "primaryOutcome",
      pills: [
        { label: "Trust", value: "Build trust" },
        { label: "Act", value: "Take a specific action" },
        { label: "Learn", value: "Walk away with a clear learning" },
        { label: "Custom", value: "__custom__" },
      ],
      allowCustom: true,
    },
    {
      id: "tone",
      message: "Any tone guardrails?",
      fieldKey: "tone",
      pills: [
        { label: "Bold", value: "Bold and direct" },
        { label: "Warm", value: "Warm and conversational" },
        { label: "Analytical", value: "Analytical / precise" },
        { label: "Custom", value: "__custom__" },
      ],
      allowCustom: true,
    },
    {
      id: "extra",
      message: "Anything else the model should respect?",
      fieldKey: "extraNotes",
      pills: [
        { label: "No emojis", value: "Avoid emojis" },
        { label: "Short sentences", value: "Prefer very short sentences" },
        { label: "Skip hashtags", value: "Minimize hashtags" },
        { label: "Custom", value: "__custom__" },
      ],
      allowCustom: true,
    },
  ];
}
