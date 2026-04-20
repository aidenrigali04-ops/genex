import { createClient } from "@/lib/supabase/server";
import {
  projectSessionFromRow,
  type GenerationsApiRow,
} from "@/lib/projects";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
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

  const { id } = await ctx.params;
  if (!id || !isUuid(id)) {
    return Response.json(
      { data: null, error: "Invalid generation id" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("generations")
    .select(
      "id, title, input_text, input_url, output, type, created_at, updated_at",
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return Response.json(
      { data: null, error: error.message },
      { status: 500 },
    );
  }

  if (!data) {
    return Response.json(
      { data: null, error: "Not found" },
      { status: 404 },
    );
  }

  return Response.json({
    data: projectSessionFromRow(data as GenerationsApiRow),
    error: null,
  });
}

type PatchBody = {
  title?: unknown;
  output_text?: unknown;
};

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
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

  const { id } = await ctx.params;
  if (!id || !isUuid(id)) {
    return Response.json(
      { data: null, error: "Invalid generation id" },
      { status: 400 },
    );
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return Response.json(
      { data: null, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const patch: { title?: string; output?: string } = {};
  if (body.title !== undefined) {
    if (typeof body.title !== "string") {
      return Response.json(
        { data: null, error: "title must be a string" },
        { status: 400 },
      );
    }
    patch.title = body.title.trim().slice(0, 500);
  }
  if (body.output_text !== undefined) {
    if (typeof body.output_text !== "string") {
      return Response.json(
        { data: null, error: "output_text must be a string" },
        { status: 400 },
      );
    }
    patch.output = body.output_text;
  }

  if (Object.keys(patch).length === 0) {
    return Response.json(
      { data: null, error: "No valid fields to update" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("generations")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return Response.json(
      { data: null, error: error.message },
      { status: 500 },
    );
  }

  if (!data) {
    return Response.json(
      { data: null, error: "Not found" },
      { status: 404 },
    );
  }

  return Response.json({ data: { id: data.id as string }, error: null });
}
