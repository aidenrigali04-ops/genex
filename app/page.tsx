import { redirect } from "next/navigation";

import { HomeWorkspace } from "@/components/home-workspace";
import {
  GUEST_LIFETIME_FREE_CREDITS,
  isUnlimitedCreditsModeServer,
  UNLIMITED_CREDITS_SENTINEL,
} from "@/lib/credits-config";
import { isBillingEntitled } from "@/lib/billing-entitlement";
import { parseStoredGenerationOutput } from "@/lib/generation-output";
import {
  remainingCreditsForDisplay,
  type ProfileCreditsRow,
} from "@/lib/profile-credits-display";
import { isPlatformId, type PlatformId } from "@/lib/platforms";
import type { AdaSidebarVoiceProfile } from "@/components/genex/ada-sidebar";
import type { ClipPackageHistoryItem } from "@/components/home-workspace";
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
  let creditMeterMax = GUEST_LIFETIME_FREE_CREDITS;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select(
        "credits, last_reset_at, unlimited_credits, subscription_status, plan_credits_remaining, bonus_credits, monthly_credit_allowance, current_streak, niche, tone_preference, hook_style",
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

    const entitled = isBillingEntitled(
      (profile as { subscription_status?: string | null } | null)
        ?.subscription_status,
      profileUnlimited,
    );

    if (
      !unlimitedCredits &&
      !profileUnlimited &&
      !entitled
    ) {
      redirect(`/onboarding/plan?next=${encodeURIComponent("/")}`);
    }

    if (unlimitedCredits || profileUnlimited) {
      initialCreditsRemaining = UNLIMITED_CREDITS_SENTINEL;
      creditMeterMax = Math.max(
        100,
        (profile as { monthly_credit_allowance?: number } | null)
          ?.monthly_credit_allowance ?? 0,
      );
    } else if (profile) {
      const row = profile as ProfileCreditsRow;
      initialCreditsRemaining = remainingCreditsForDisplay(row);
      const monthly = Math.max(
        0,
        Math.floor(
          Number(
            (profile as { monthly_credit_allowance?: number | null })
              .monthly_credit_allowance ?? 0,
          ),
        ),
      );
      creditMeterMax = Math.max(
        10,
        monthly,
        typeof initialCreditsRemaining === "number"
          ? initialCreditsRemaining
          : 0,
      );
    } else {
      initialCreditsRemaining = 0;
      creditMeterMax = 100;
    }

    const { data: rows, error: clipError } = await supabase
      .from("generations")
      .select(
        "id, created_at, input_text, input_url, platforms, output, generation_context, type",
      )
      .eq("user_id", user.id)
      .in("type", ["clip_package", "generic"])
      .order("created_at", { ascending: false })
      .limit(80);

    if (!clipError && rows) {
      clipRows = rows as Record<string, unknown>[];
    }

    const { count } = await supabase
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("type", ["clip_package", "generic"]);

    totalClipCount = count ?? 0;
  }

  const initialClipPackages = clipRows.map((row) => {
    const output = typeof row.output === "string" ? row.output : "";
    const { displayOutput, platforms: parsedPlatforms } =
      parseStoredGenerationOutput(output);
    const rawPlatforms = Array.isArray(row.platforms) ? row.platforms : [];
    const platforms: PlatformId[] =
      parsedPlatforms ?? rawPlatforms.filter(isPlatformId);

    const rowType: ClipPackageHistoryItem["generationKind"] =
      row.type === "generic" ? "generic" : "clip_package";
    return {
      id: String(row.id),
      createdAt: String(row.created_at),
      inputText: (row.input_text as string | null) ?? null,
      inputUrl: (row.input_url as string | null) ?? null,
      output: displayOutput,
      platforms,
      generationContext: row.generation_context ?? null,
      generationKind: rowType,
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
      creditMeterMax={creditMeterMax}
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
