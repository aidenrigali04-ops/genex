"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, Lock, Mail } from "lucide-react";

import { signInWithEmail, signInWithGoogle } from "@/app/auth/actions";
import { AdaFigmaAmbientBackground } from "@/components/genex/ada-figma-dashboard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAGENTA_GRAD =
  "bg-[linear-gradient(5deg,#D31CD7_0%,#8800DC_100%)] shadow-[0_0_20px_rgba(203,45,206,0.24)]";

function AuthField({
  icon: Icon,
  label,
  name,
  type = "text",
  autoComplete,
  required,
}: {
  icon: typeof Mail;
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="flex w-full max-w-[400px] cursor-text items-center gap-2 rounded-[10px] border border-white/24 bg-white/16 px-3 py-2.5 outline outline-1 -outline-offset-1 outline-white/24">
      <Icon className="size-4 shrink-0 text-white/64" aria-hidden />
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        placeholder={label}
        className="min-w-0 flex-1 bg-transparent font-[family-name:var(--font-instrument-sans)] text-sm leading-5 tracking-[0.14px] text-white placeholder:text-white/64 outline-none"
      />
    </label>
  );
}

export function AdaLoginView() {
  const searchParams = useSearchParams();
  const authError = searchParams.get("authError");
  const next = searchParams.get("next") ?? "/";

  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-[#0A050F] text-white">
      <AdaFigmaAmbientBackground />

      <div className="relative z-[1] flex min-h-dvh flex-col items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-[400px] flex-col gap-8">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              aria-label="Back to app"
              className="flex size-10 shrink-0 items-center justify-center rounded-[22px] border border-white/32 text-white outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[#8800DC]/50"
            >
              <ChevronLeft className="size-5" />
            </Link>
            <h1
              className="font-[family-name:var(--font-instrument-serif)] text-[30px] leading-[48px] tracking-[0.3px] text-white"
              style={{ fontWeight: 400 }}
            >
              Log in
            </h1>
          </div>

          <div className="flex flex-col gap-2 text-center">
            <h2
              className="font-[family-name:var(--font-instrument-serif)] text-[30px] leading-9 text-white"
              style={{ fontWeight: 400 }}
            >
              Welcome back
            </h2>
            <p className="font-[family-name:var(--font-instrument-sans)] text-sm leading-5 tracking-[0.14px] text-white/64">
              Sign in to continue creating with Ada
            </p>
          </div>

          {authError ? (
            <p
              className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-center text-sm text-red-200"
              role="alert"
            >
              {authError}
            </p>
          ) : null}

          <form
            action={signInWithEmail}
            className="flex flex-col items-center gap-4"
          >
            <input type="hidden" name="next" value={next} />
            <AuthField
              icon={Mail}
              label="Email address"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
            <AuthField
              icon={Lock}
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            <Button
              type="submit"
              className={cn(
                "mt-2 h-auto w-full rounded-[32px] border-0 px-4 py-2 font-[family-name:var(--font-instrument-sans)] text-sm font-medium leading-6 tracking-[0.14px] text-white",
                MAGENTA_GRAD,
              )}
            >
              Sign in
            </Button>
          </form>

          <form action={signInWithGoogle} className="flex flex-col gap-2">
            <input type="hidden" name="next" value={next} />
            <Button
              type="submit"
              variant="outline"
              className="h-auto w-full rounded-[32px] border-white/32 bg-white/5 py-2 font-[family-name:var(--font-instrument-sans)] text-sm text-white hover:bg-white/10"
            >
              Continue with Google
            </Button>
          </form>

          <div className="border-t border-white pt-5 text-center">
            <Link
              href={`/auth/sign-up?next=${encodeURIComponent(next)}`}
              className="font-[family-name:var(--font-instrument-sans)] text-sm text-white underline-offset-2 hover:underline"
            >
              Create an account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
