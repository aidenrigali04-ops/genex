/**
 * Clip package uses a long system prompt; keep user source bounded so OpenAI
 * TPM limits (e.g. 30k/min) are less likely to reject the request.
 */
export const MAX_CLIP_SOURCE_CHARS = 14_000;

export function capSourceTextForClipModel(sourceText: string): {
  forModel: string;
  wasTruncated: boolean;
} {
  if (sourceText.length <= MAX_CLIP_SOURCE_CHARS) {
    return { forModel: sourceText, wasTruncated: false };
  }
  return {
    forModel: `${sourceText.slice(0, MAX_CLIP_SOURCE_CHARS)}\n\n[Source truncated to ${MAX_CLIP_SOURCE_CHARS.toLocaleString()} characters for model rate limits. The full input is still saved with your generation.]`,
    wasTruncated: true,
  };
}
