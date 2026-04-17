/** Prefix lines embedded at the start of the plain-text stream (before model tokens). */
export const GENEX_STEP_PREFIX = "[[GENEX:STEP]]";
export const GENEX_FATAL_PREFIX = "[[GENEX:FATAL]]";

export type GenerationUiStep = {
  id: string;
  label: string;
  /** Unix ms — added by the server */
  ts?: number;
};

export type GenerationFatalPayload = {
  error?: string;
  message?: string;
};

export type GenerationStreamParser = {
  push(chunk: string): {
    textDelta: string;
    steps: GenerationUiStep[];
    fatal: GenerationFatalPayload | null;
  };
  /** Call after the reader finishes so a trailing buffer without `\n` still becomes body text. */
  end(): {
    textDelta: string;
    steps: GenerationUiStep[];
    fatal: GenerationFatalPayload | null;
  };
};

/**
 * Parses a chunked `text/plain` generation stream: leading step lines, optional fatal JSON line,
 * then raw model text.
 */
export function createGenerationStreamParser(): GenerationStreamParser {
  let mode: "lines" | "body" = "lines";
  let carry = "";

  function push(chunk: string): {
    textDelta: string;
    steps: GenerationUiStep[];
    fatal: GenerationFatalPayload | null;
  } {
    const steps: GenerationUiStep[] = [];
    let textDelta = "";
    let fatal: GenerationFatalPayload | null = null;

    carry += chunk;

    if (mode === "body") {
      textDelta = carry;
      carry = "";
      return { textDelta, steps, fatal };
    }

    while (true) {
      const nl = carry.indexOf("\n");
      if (nl === -1) break;
      const line = carry.slice(0, nl);
      carry = carry.slice(nl + 1);

      if (line.startsWith(GENEX_FATAL_PREFIX)) {
        try {
          fatal = JSON.parse(
            line.slice(GENEX_FATAL_PREFIX.length),
          ) as GenerationFatalPayload;
        } catch {
          fatal = { error: "parse_error", message: line.slice(GENEX_FATAL_PREFIX.length) };
        }
        mode = "body";
        textDelta = carry;
        carry = "";
        return { textDelta, steps, fatal };
      }

      if (line.startsWith(GENEX_STEP_PREFIX)) {
        try {
          const o = JSON.parse(line.slice(GENEX_STEP_PREFIX.length)) as {
            id?: string;
            label?: string;
            ts?: unknown;
          };
          if (typeof o.id === "string" && typeof o.label === "string") {
            steps.push({
              id: o.id,
              label: o.label,
              ts: typeof o.ts === "number" ? o.ts : undefined,
            });
          }
        } catch {
          /* ignore malformed step line */
        }
        continue;
      }

      mode = "body";
      textDelta = line + (carry.length ? `\n${carry}` : "");
      carry = "";
      return { textDelta, steps, fatal };
    }

    return { textDelta, steps, fatal };
  }

  function end(): {
    textDelta: string;
    steps: GenerationUiStep[];
    fatal: GenerationFatalPayload | null;
  } {
    if (mode === "lines" && carry.length > 0) {
      const steps: GenerationUiStep[] = [];
      const textDelta = carry;
      carry = "";
      mode = "body";
      return { textDelta, steps, fatal: null };
    }
    return { textDelta: "", steps: [], fatal: null };
  }

  return { push, end };
}
