"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { normalizeInternalReturnPath } from "@/lib/normalize-internal-return-path";
import { createClient } from "@/lib/supabase/server";

const OAUTH_RETURN_COOKIE = "auth_return_path";

function getBaseUrl(origin: string | null) {
  return origin ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export async function signInWithGoogle(formData: FormData) {
  const supabase = await createClient();
  const headerStore = await headers();
  const baseUrl = getBaseUrl(headerStore.get("origin"));

  const nextField = formData.get("next");
  const nextRaw = typeof nextField === "string" ? nextField : "";
  const next = normalizeInternalReturnPath(
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/",
  );

  const cookieStore = await cookies();
  cookieStore.set(OAUTH_RETURN_COOKIE, next, {
    path: "/",
    maxAge: 600,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${baseUrl}/auth/callback`,
    },
  });

  if (error || !data.url) {
    redirect(
      `/?authError=${encodeURIComponent(error?.message ?? "OAuth failed")}`,
    );
  }

  redirect(data.url);
}

export async function signInWithEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const nextField = formData.get("next");
  const nextRaw = typeof nextField === "string" ? nextField : "";
  const next = normalizeInternalReturnPath(
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/",
  );
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(
      `/auth/login?authError=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`,
    );
  }

  redirect(next);
}

export async function signUpWithEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const username = String(formData.get("username") ?? "").trim();
  const termsAccepted = formData.get("termsAccepted") === "on";
  const promoEmails = formData.get("promoEmails") === "on";

  const nextField = formData.get("next");
  const nextRaw = typeof nextField === "string" ? nextField : "";
  const next = normalizeInternalReturnPath(
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/",
  );

  const qNext = `next=${encodeURIComponent(next)}`;

  if (!termsAccepted) {
    redirect(
      `/auth/sign-up?authError=${encodeURIComponent("Please accept the terms of use.")}&${qNext}`,
    );
  }
  if (password !== confirmPassword) {
    redirect(
      `/auth/sign-up?authError=${encodeURIComponent("Passwords do not match.")}&${qNext}`,
    );
  }
  if (password.length < 6) {
    redirect(
      `/auth/sign-up?authError=${encodeURIComponent("Password must be at least 6 characters.")}&${qNext}`,
    );
  }

  const headerStore = await headers();
  const baseUrl = getBaseUrl(headerStore.get("origin"));
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${baseUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      data: {
        ...(username ? { username, display_name: username } : {}),
        promo_emails: promoEmails,
      },
    },
  });

  if (error) {
    redirect(
      `/auth/sign-up?authError=${encodeURIComponent(error.message)}&${qNext}`,
    );
  }

  if (data.session) {
    redirect(`/onboarding/plan?next=${encodeURIComponent(next)}`);
  }

  redirect(
    `/auth/sign-up?authSuccess=${encodeURIComponent("Check your inbox to confirm your email.")}&${qNext}`,
  );
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
