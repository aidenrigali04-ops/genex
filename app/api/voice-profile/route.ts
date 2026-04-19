import { trackAha } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type VoiceProfileBody = {
  niche?: unknown;
  tone_preference?: unknown;
  hook_style?: unknown;
};

function strField(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

export async function PATCH(req: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: VoiceProfileBody;
  try {
    body = (await req.json()) as VoiceProfileBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const updates: Record<string, string> = {};
  const niche = strField(body.niche, 100);
  const tone = strField(body.tone_preference, 100);
  const hook = strField(body.hook_style, 100);
  if (niche !== undefined) updates.niche = niche;
  if (tone !== undefined) updates.tone_preference = tone;
  if (hook !== undefined) updates.hook_style = hook;

  if (Object.keys(updates).length === 0) {
    return Response.json(
      { error: "No valid fields provided." },
      { status: 400 },
    );
  }

  const { data: before } = await supabase
    .from("profiles")
    .select("niche, tone_preference, hook_style")
    .eq("id", user.id)
    .maybeSingle();

  const payload = {
    id: user.id,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("profiles")
    .upsert(payload, { onConflict: "id" })
    .select("niche, tone_preference, hook_style")
    .single();

  if (error) {
    console.error("[voice-profile]", error.message);
    return Response.json(
      { error: "Failed to save voice profile." },
      { status: 500 },
    );
  }

  const row = data as {
    niche: string | null;
    tone_preference: string | null;
    hook_style: string | null;
  } | null;

  const beforeN = before?.niche ?? null;
  const beforeT = before?.tone_preference ?? null;
  const beforeH = before?.hook_style ?? null;
  const wasComplete =
    Boolean(beforeN?.trim()) &&
    Boolean(beforeT?.trim()) &&
    Boolean(beforeH?.trim());

  const isNowComplete =
    Boolean(row?.niche?.trim()) &&
    Boolean(row?.tone_preference?.trim()) &&
    Boolean(row?.hook_style?.trim());

  if (!wasComplete && isNowComplete) {
    void trackAha(supabase, user.id, "voice_profile_complete");
  }

  return Response.json({ data: row });
}
