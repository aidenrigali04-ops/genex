import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { z } from "zod";

import { formatGenerationContextForPrompt } from "@/lib/generation-context";
import { isUnlimitedCreditsModeServer } from "@/lib/credits-config";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

const bodySchema = z.object({
  originalPrompt: z.string().max(24_000),
  generationContext: z.unknown().optional().nullable(),
  variationsOutput: z.string().max(600_000),
  userMessage: z.string().max(16_000),
});

const FEEDBACK_SYSTEM = `You are a short-form content strategist reviewing AI-generated content variations. The user has seen their generated outputs and is asking for feedback, refinements, or specific changes. Be direct, specific, and actionable. If the user asks you to rewrite something, do it immediately. If they ask which variation is best, give a clear recommendation with a specific reason tied to platform psychology.`;

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "Missing OPENAI_API_KEY in environment." },
      { status: 500 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "bad_request", message: parsed.error.message },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) {
    return Response.json({ error: "sign_in_required" }, { status: 401 });
  }

  const userId = session.user.id;

  if (!isUnlimitedCreditsModeServer()) {
    type CreditRow = {
      success: boolean;
      reason: string | null;
      remaining: number;
    };

    const { error: profileBootstrapErr } = await supabase
      .from("profiles")
      .insert({ id: userId });
    if (
      profileBootstrapErr &&
      profileBootstrapErr.code !== "23505" &&
      !profileBootstrapErr.message.toLowerCase().includes("duplicate")
    ) {
      console.warn("[feedback] profiles bootstrap:", profileBootstrapErr.message);
    }

    const { data: creditData, error: creditError } = await supabase.rpc(
      "consume_credits",
      { p_cost: 1, p_user_id: userId },
    );

    if (creditError) {
      console.error("[feedback] consume_credits failed", creditError.message);
      return Response.json(
        {
          error: "credit_check_failed",
          message: "Could not verify credits.",
        },
        { status: 503 },
      );
    }

    const creditRow = (
      Array.isArray(creditData) ? creditData[0] : creditData
    ) as CreditRow | undefined;

    if (
      !creditRow ||
      typeof creditRow.success !== "boolean" ||
      creditRow.success !== true
    ) {
      if (creditRow?.reason === "no_credits") {
        return Response.json({ error: "no_credits" }, { status: 403 });
      }
      return Response.json(
        {
          error: "credit_denied",
          message: creditRow?.reason ?? "Could not use a credit.",
        },
        { status: 403 },
      );
    }
  }

  const { originalPrompt, generationContext, variationsOutput, userMessage } =
    parsed.data;

  const ctxBlock = formatGenerationContextForPrompt(generationContext ?? null);
  const userBlock = [
    ctxBlock ? `User context from refinement:\n${ctxBlock}\n` : "",
    `Original generation prompt:\n${originalPrompt}\n`,
    `Generated outputs (text dump):\n---\n${variationsOutput}\n---\n`,
    `User question:\n${userMessage}`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = streamText({
    model: openai("gpt-4o"),
    maxOutputTokens: 4096,
    system: FEEDBACK_SYSTEM,
    prompt: userBlock,
  });

  return result.toTextStreamResponse({
    headers: { "Cache-Control": "no-store" },
  });
}
