import { trackAha } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type VoiceProfileRow = {
  niche: string | null;
  tone_preference: string | null;
  hook_style: string | null;
};

type VoiceProfileBody = {
  niche?: unknown;
  tone_preference?: unknown;
  hook_style?: unknown;
};

function sanitize(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim().slice(0, 100);
  return trimmed.length > 0 ? trimmed : null;
}

function isComplete(row: VoiceProfileRow | null | undefined): boolean {
  return (
    Boolean(row?.niche?.trim()) &&
    Boolean(row?.tone_preference?.trim()) &&
    Boolean(row?.hook_style?.trim())
  );
}

export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user?.id) {
    return Response.json(
      { data: null, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("niche, tone_preference, hook_style")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return Response.json(
      { data: null, error: error.message },
      { status: 500 },
    );
  }

  const row: VoiceProfileRow = data
    ? (data as VoiceProfileRow)
    : { niche: null, tone_preference: null, hook_style: null };

  return Response.json({ data: row, error: null });
}

export async function PATCH(req: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user?.id) {
    return Response.json(
      { data: null, error: "Unauthorized" },
      { status: 401 },
    );
  }

  let body: VoiceProfileBody;
  try {
    body = (await req.json()) as VoiceProfileBody;
  } catch {
    return Response.json(
      { data: null, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const niche = sanitize(body.niche);
  const tone_preference = sanitize(body.tone_preference);
  const hook_style = sanitize(body.hook_style);

  const { data: existing, error: readErr } = await supabase
    .from("profiles")
    .select("niche, tone_preference, hook_style")
    .eq("id", user.id)
    .maybeSingle();

  if (readErr) {
    return Response.json(
      { data: null, error: readErr.message },
      { status: 500 },
    );
  }

  const wasComplete = isComplete(existing as VoiceProfileRow | null);

  const { error: upsertErr } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      niche,
      tone_preference,
      hook_style,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (upsertErr) {
    console.error("[voice-profile] upsert", upsertErr.message);
    return Response.json(
      { data: null, error: upsertErr.message },
      { status: 500 },
    );
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("niche, tone_preference, hook_style")
    .eq("id", user.id)
    .single();

  if (error) {
    return Response.json(
      { data: null, error: error.message },
      { status: 500 },
    );
  }

  const row = data as VoiceProfileRow;
  const nowComplete = isComplete(row);

  if (nowComplete && !wasComplete) {
    void trackAha(supabase, user.id, "voice_profile_saved");
  }

  return Response.json({ data: row, error: null });
}
