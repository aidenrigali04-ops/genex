import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { planShots } from "@/worker/text-video/shot-planner.js";

const bodySchema = z.object({
  script: z.string().min(20).max(8000),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const shots = await planShots(parsed.data.script);
    return Response.json({ shots });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to plan shots";
    console.error("[text-video-jobs/preview]", message);
    return Response.json(
      { error: "preview_failed", message: message.slice(0, 200) },
      { status: 502 },
    );
  }
}
