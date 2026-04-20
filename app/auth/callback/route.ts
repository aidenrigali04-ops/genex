import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isBillingEntitled } from "@/lib/billing-entitlement";
import { isUnlimitedCreditsModeServer } from "@/lib/credits-config";
import { normalizeInternalReturnPath } from "@/lib/normalize-internal-return-path";
import { createClient } from "@/lib/supabase/server";

const OAUTH_RETURN_COOKIE = "auth_return_path";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(OAUTH_RETURN_COOKIE)?.value;
  const fromQuery = requestUrl.searchParams.get("next");
  /** Prefer explicit `next` on the URL (e.g. email confirmation); else OAuth cookie. */
  const nextRaw = fromQuery ?? fromCookie ?? "/";
  const safeNext = normalizeInternalReturnPath(
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/",
  );

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      cookieStore.delete(OAUTH_RETURN_COOKIE);

      if (!isUnlimitedCreditsModeServer()) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("subscription_status, unlimited_credits")
            .eq("id", user.id)
            .maybeSingle();
          const row = profile as {
            subscription_status?: string | null;
            unlimited_credits?: boolean | null;
          } | null;
          const profileUnlimited = Boolean(row?.unlimited_credits);
          if (
            !isBillingEntitled(row?.subscription_status, profileUnlimited)
          ) {
            return NextResponse.redirect(
              new URL(
                `/onboarding/plan?next=${encodeURIComponent(safeNext)}`,
                requestUrl.origin,
              ),
            );
          }
        }
      }

      return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
    }
  }

  return NextResponse.redirect(
    new URL(
      `/?authError=${encodeURIComponent("Could not authenticate user")}`,
      requestUrl.origin,
    ),
  );
}
