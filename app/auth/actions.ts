"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function getBaseUrl(origin: string | null) {
  return origin ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export async function signInWithGoogle() {
  const supabase = await createClient();
  const headerStore = await headers();
  const baseUrl = getBaseUrl(headerStore.get("origin"));

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${baseUrl}/auth/callback`,
    },
  });

  if (error || !data.url) {
    redirect(`/?authError=${encodeURIComponent(error?.message ?? "OAuth failed")}`);
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
