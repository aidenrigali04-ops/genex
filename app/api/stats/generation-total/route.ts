import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Public total count of rows in `generations` (social proof). Uses service role;
 * returns 0 if service role is not configured.
 */
export async function GET(): Promise<Response> {
  const admin = createServiceRoleClient();
  if (!admin) {
    return Response.json(
      { count: 0 },
      {
        headers: {
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
        },
      },
    );
  }

  const { count, error } = await admin
    .from("generations")
    .select("id", { count: "exact", head: true });

  if (error) {
    console.error("[stats/generation-total]", error.message);
    return Response.json({ count: 0 }, { status: 200 });
  }

  return Response.json(
    { count: count ?? 0 },
    {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
      },
    },
  );
}
