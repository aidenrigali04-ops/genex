import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  email: z.string().email().max(320),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("waitlist")
    .insert({ email: parsed.data.email.trim().toLowerCase() });

  if (error) {
    if (error.code === "23505") {
      return Response.json({ ok: true, duplicate: true });
    }
    if (error.code === "42P01") {
      return Response.json(
        {
          error:
            "Waitlist table missing. Run supabase/migrations/20260416140000_credits_waitlist_consume.sql",
        },
        { status: 503 },
      );
    }
    console.error("waitlist insert failed", error.message);
    return Response.json({ error: "Could not save email." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
