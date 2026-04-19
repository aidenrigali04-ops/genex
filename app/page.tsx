import { HomeWorkspace } from "@/components/home-workspace";
import {
  isUnlimitedCreditsModeServer,
  UNLIMITED_CREDITS_SENTINEL,
} from "@/lib/credits-config";
import { parseStoredGenerationOutput } from "@/lib/generation-output";
import { remainingCreditsForDisplay } from "@/lib/profile-credits-display";
import { isPlatformId, type PlatformId } from "@/lib/platforms";
import type { AdaSidebarVoiceProfile } from "@/components/genex/ada-sidebar";
import { createClient } from "@/lib/supabase/server";

type SearchParams = {
  authError?: string;
  authSuccess?: string;
};

type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const unlimitedCredits = isUnlimitedCreditsModeServer();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let initialCreditsRemaining: number | null = null;
  let initialCurrentStreak = 0;
  let initialVoiceProfile: AdaSidebarVoiceProfile | null = null;
  let clipRows: Record<string, unknown>[] = [];
  let totalClipCount = 0;
  let profileUnlimited = false;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select(
        "credits, last_reset_at, unlimited_credits, current_streak, niche, tone_preference, hook_style",
      )
      .eq("id", user.id)
      .maybeSingle();

    profileUnlimited =
      profile != null &&
      (profile as { unlimited_credits?: boolean }).unlimited_credits === true;

    const streakVal = (profile as { current_streak?: number } | null)
      ?.current_streak;
    if (typeof streakVal === "number") {
      initialCurrentStreak = streakVal;
    }

    if (profile) {
      const vp = profile as {
        niche?: string | null;
        tone_preference?: string | null;
        hook_style?: string | null;
      };
      initialVoiceProfile = {
        niche: vp.niche ?? null,
        tone_preference: vp.tone_preference ?? null,
        hook_style: vp.hook_style ?? null,
      };
    }

    if (unlimitedCredits || profileUnlimited) {
      initialCreditsRemaining = UNLIMITED_CREDITS_SENTINEL;
    } else if (profile) {
      initialCreditsRemaining = remainingCreditsForDisplay({
        credits: profile.credits as number | null,
        last_reset_at: profile.last_reset_at as string | null,
      });
    } else {
      initialCreditsRemaining = 3;
    }

    const { data: rows, error: clipError } = await supabase
      .from("generations")
      .select("id, created_at, input_text, input_url, platforms, output, generation_context")
      .eq("type", "clip_package")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);

    if (!clipError && rows) {
      clipRows = rows as Record<string, unknown>[];
    }

    const { count } = await supabase
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("type", "clip_package")
      .eq("user_id", user.id);

    totalClipCount = count ?? 0;
  }

  const initialClipPackages = clipRows.map((row) => {
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
      generationContext: row.generation_context ?? null,
    };
  });

  return (
    <HomeWorkspace
      initialUser={
        user
          ? { id: user.id, email: user.email ?? "(no email)" }
          : null
      }
      initialCreditsRemaining={initialCreditsRemaining}
      initialClipPackages={initialClipPackages}
      totalClipCount={totalClipCount}
      initialCurrentStreak={initialCurrentStreak}
      initialVoiceProfile={initialVoiceProfile}
      unlimitedCredits={unlimitedCredits || profileUnlimited}
      authError={params.authError ?? null}
      authSuccess={params.authSuccess ?? null}
    />
  );
}
