import { redirect } from "next/navigation";

import { DashboardClient } from "@/app/dashboard/dashboard-client";
import { parseStoredGenerationOutput } from "@/lib/generation-output";
import { isPlatformId, type PlatformId } from "@/lib/platforms";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=%2Fdashboard");
  }

  const { data: clipRows, error: clipError } = await supabase
    .from("generations")
    .select("id, created_at, input_text, input_url, platforms, output")
    .eq("type", "clip_package")
    .order("created_at", { ascending: false })
    .limit(20);

  if (clipError) {
    console.error("clip generations query failed", clipError.message);
  }

  const initialClipPackages = (clipRows ?? []).map((row) => {
    const output = typeof row.output === "string" ? row.output : "";
    const { displayOutput, platforms: parsedPlatforms } =
      parseStoredGenerationOutput(output);
    const rawPlatforms = Array.isArray(row.platforms) ? row.platforms : [];
    const platforms: PlatformId[] =
      parsedPlatforms ?? rawPlatforms.filter(isPlatformId);

    return {
      id: String(row.id),
      createdAt: String(row.created_at),
      inputText: (row.input_text as string | null) ?? null,
      inputUrl: (row.input_url as string | null) ?? null,
      output: displayOutput,
      platforms,
    };
  });

  return (
    <DashboardClient
      initialUser={{
        id: user.id,
        email: user.email ?? "(no email on account)",
      }}
      initialClipPackages={initialClipPackages}
    />
  );
}
