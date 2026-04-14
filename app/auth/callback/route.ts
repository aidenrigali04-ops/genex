import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const OAUTH_RETURN_COOKIE = "auth_return_path";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(OAUTH_RETURN_COOKIE)?.value;
  const fromQuery = requestUrl.searchParams.get("next");
  const nextRaw = fromCookie ?? fromQuery ?? "/";
  const safeNext =
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      cookieStore.delete(OAUTH_RETURN_COOKIE);
      return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
    }
  }

  return NextResponse.redirect(
    new URL(
      `/login?authError=${encodeURIComponent("Could not authenticate user")}`,
      requestUrl.origin,
    ),
  );
}
