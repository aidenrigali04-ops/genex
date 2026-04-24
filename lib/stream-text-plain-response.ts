import { streamText } from "ai";

function formatStreamError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export type StreamTextResult = ReturnType<typeof streamText>;
export type PlainTextStreamOutcome = {
  sawText: boolean;
  emittedFailureHint: boolean;
  streamError?: string;
};

type PipeStreamTextOptions = {
  /** Write inline error hints into the plain-text stream (default true). */
  emitErrorHints?: boolean;
};

/**
 * Forwards `fullStream` text deltas and error/finish hints to `append`.
 */
export async function pipeStreamTextAsPlainText(
  result: StreamTextResult,
  append: (s: string) => void,
  options?: PipeStreamTextOptions,
): Promise<PlainTextStreamOutcome> {
  const emitErrorHints = options?.emitErrorHints ?? true;
  let sawText = false;
  let emittedFailureHint = false;

  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta": {
          if (part.text) {
            sawText = true;
            append(part.text);
          }
          break;
        }
        case "error": {
          const errMsg = formatStreamError(part.error);
          if (!emitErrorHints) {
            if (sawText) {
              return { sawText, emittedFailureHint, streamError: errMsg };
            }
            throw new Error(errMsg);
          }
          emittedFailureHint = true;
          append(`\n\n[Model error] ${errMsg}\n\n`);
          break;
        }
        case "finish": {
          if (
            !sawText &&
            (part.finishReason === "content-filter" ||
              part.finishReason === "error")
          ) {
            emittedFailureHint = true;
            append(
              `[Generation stopped: ${part.finishReason}${part.rawFinishReason ? ` — ${part.rawFinishReason}` : ""}]`,
            );
          }
          break;
        }
        default:
          break;
      }
    }
    if (!sawText && !emittedFailureHint) return { sawText, emittedFailureHint };
  } catch (e: unknown) {
    if (!emitErrorHints) {
      throw e;
    }
    append(
      `\n\n[Stream error] ${e instanceof Error ? e.message : String(e)}\n\n`,
    );
    emittedFailureHint = true;
  }
  return { sawText, emittedFailureHint };
}

/**
 * Like `toTextStreamResponse()`, but forwards `fullStream` so `error` and
 * zero-token `finish` reasons still produce visible plain text for the client.
 */
export function streamTextToPlainTextResponse(
  result: StreamTextResult,
  init?: ResponseInit,
): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const append = (s: string) => {
        if (s) controller.enqueue(encoder.encode(s));
      };
      try {
        const outcome = await pipeStreamTextAsPlainText(result, append);
        if (!outcome.sawText && !outcome.emittedFailureHint) {
          append(
            "[No text was generated. Check your API key, model access, or try a shorter input.]",
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    ...init,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...(init?.headers as Record<string, string>),
    },
  });
}
