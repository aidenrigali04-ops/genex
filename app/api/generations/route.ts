import { createClient } from "@/lib/supabase/server";
import {
  projectSessionFromRow,
  type GenerationsApiRow,
} from "@/lib/projects";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    .from("generations")
    .select(
      "id, title, input_text, input_url, output, type, created_at, updated_at",
    )
    .eq("user_id", user.id)
    .neq("output", "")
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) {
    return Response.json(
      { data: null, error: error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as GenerationsApiRow[];
  return Response.json({
    data: rows.map(projectSessionFromRow),
    error: null,
  });
}
