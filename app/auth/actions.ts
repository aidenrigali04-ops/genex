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
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(`/?authError=${encodeURIComponent(error.message)}`);
  }

  redirect("/");
}

export async function signUpWithEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const headerStore = await headers();
  const baseUrl = getBaseUrl(headerStore.get("origin"));
  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${baseUrl}/auth/callback`,
    },
  });

  if (error) {
    redirect(`/?authError=${encodeURIComponent(error.message)}`);
  }

  redirect("/?authSuccess=Check your inbox to confirm your email.");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
