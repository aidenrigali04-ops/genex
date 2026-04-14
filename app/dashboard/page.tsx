import { redirect } from "next/navigation";

import { DashboardClient } from "@/app/dashboard/dashboard-client";
import {
  DAILY_FREE_GENERATION_LIMIT,
  effectiveDailyGenerationsUsed,
} from "@/lib/daily-generation-limit";
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
    if (clipError.code === "42703") {
      console.warn(
        "[dashboard] generations table is missing columns (e.g. input_text). Run the migrations in supabase/migrations/, especially 20260414120000_generations.sql and 20260415101000_generations_add_app_columns.sql, in the Supabase SQL editor.",
        clipError.message,
      );
    } else {
      console.error("clip generations query failed", clipError.message);
    }
  }

  let dailyGenerationUsage = {
    used: 0,
    limit: DAILY_FREE_GENERATION_LIMIT,
  };

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("daily_generations, last_reset_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    if (profileError.code === "42P01") {
      console.warn(
        "[dashboard] public.profiles is missing. Run supabase/migrations/20260416120000_profiles_daily_generations.sql in the Supabase SQL editor.",
        profileError.message,
      );
    } else {
      console.warn("[dashboard] profiles query failed", profileError.message);
    }
  } else if (profileRow) {
    dailyGenerationUsage = {
      used: effectiveDailyGenerationsUsed(
        profileRow.daily_generations as number | null,
        profileRow.last_reset_at as string | null,
      ),
      limit: DAILY_FREE_GENERATION_LIMIT,
    };
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
      initialDailyGenerationUsage={dailyGenerationUsage}
    />
  );
}
