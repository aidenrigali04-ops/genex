import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  jobId: z.string().optional(),
  generationId: z.string().optional(),
  rating: z.enum(["up", "down"]),
  kind: z.enum(["video", "text"]),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return Response.json({ ok: false }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });

  const jobId = parsed.data.jobId?.trim() || null;
  const generationId = parsed.data.generationId?.trim() || null;

  const { error } = await supabase.from("generation_ratings").insert({
    user_id: session.user.id,
    job_id: jobId,
    generation_id: generationId,
    rating: parsed.data.rating,
    kind: parsed.data.kind,
  });
  if (error) {
    return Response.json({ ok: false }, { status: 500 });
  }

  return Response.json({ ok: true });
}
