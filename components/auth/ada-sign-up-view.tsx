"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  Clapperboard,
  Lock,
  LogIn,
  Mail,
  MessageCircle,
  Search,
  SlidersHorizontal,
  User,
} from "lucide-react";

import { signUpWithEmail } from "@/app/auth/actions";
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
  icon: typeof User;
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

function AdaMarketingPanel() {
  return (
    <div
      className={cn(
        "flex w-full flex-col justify-center gap-10 px-6 pb-5 pt-16 sm:px-10 sm:pt-[100px] lg:min-h-dvh lg:max-w-[756px] lg:flex-1",
        "bg-[rgba(198,108,255,0.08)]",
      )}
    >
      <div className="relative flex flex-col gap-1">
        <div
          className="pointer-events-none absolute -left-9 -top-44 hidden h-[200px] w-[180px] sm:block"
          aria-hidden
        >
          <div className="absolute inset-0 blur-[25px]">
            <div className="absolute left-[6px] top-4 h-[166px] w-[155px] rounded-3xl bg-[#3600AA]" />
            <div className="absolute left-[120px] top-0 h-[146px] w-[136px] rotate-[60deg] rounded-3xl bg-[#6800BA]" />
            <div className="absolute left-10 top-[134px] h-[116px] w-[107px] -rotate-[66deg] rounded-3xl bg-[#A400A7]" />
          </div>
          <div className="absolute left-[30px] top-10 flex size-[120px] items-center justify-center rounded-full bg-white/12 shadow-[0_8px_20px_rgba(0,0,0,0.16)]">
            <div className="size-14 rotate-[15deg] rounded-lg bg-white/90" />
          </div>
        </div>
        <h2
          className="font-[family-name:var(--font-instrument-serif)] text-3xl leading-[48px] text-white sm:text-4xl"
          style={{ fontWeight: 400 }}
        >
          What&apos;s new in Ada?
        </h2>
        <p className="max-w-lg font-[family-name:var(--font-instrument-sans)] text-base leading-6 tracking-[0.16px] text-white/64">
          Explore personalized recommendations and unleash creativity with AI.
          <br />
          Let&apos;s get started!
        </p>
      </div>

      <ul className="flex flex-col gap-6">
        {[
          {
            icon: Search,
            title: "Advanced Search",
            body: "Get personalized recommendations and find what you need faster and easier than anytime before.",
          },
          {
            icon: MessageCircle,
            title: "Conversational Assistance",
            body: "Engage in natural language conversations for personalized assistance and recommendations.",
          },
          {
            icon: SlidersHorizontal,
            title: "Control Hub",
            body: "Seamlessly manage settings and content generation. Take full control of your AI experience.",
          },
          {
            icon: Clapperboard,
            title: "Media Generation Tools",
            body: "Create custom images, videos and voiceovers with ease, and more with our AI-powered tools.",
          },
        ].map((row) => (
          <li
            key={row.title}
            className="flex gap-5 border-transparent sm:items-start"
          >
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-white/24 bg-white/16 outline outline-1 -outline-offset-1 outline-white/24">
              <row.icon className="size-5 text-white" aria-hidden />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h3
                className="font-[family-name:var(--font-instrument-serif)] text-[22px] leading-[30px] tracking-[0.22px] text-white"
                style={{ fontWeight: 400 }}
              >
                {row.title}
              </h3>
              <p className="font-[family-name:var(--font-instrument-sans)] text-sm leading-5 tracking-[0.14px] text-white/76">
                {row.body}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdaSignUpView() {
  const searchParams = useSearchParams();
  const authError = searchParams.get("authError");
  const next = searchParams.get("next") ?? "/";

  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-[#0A050F] text-white">
      <AdaFigmaAmbientBackground />

      <div className="relative z-[1] flex min-h-dvh flex-col lg:flex-row">
        <div className="flex w-full flex-1 flex-col items-center gap-8 px-6 py-10 sm:px-10 lg:max-w-[756px] lg:justify-center lg:py-10">
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
                Sign up
              </h1>
            </div>

            <div className="flex flex-col items-center gap-8">
              <div className="flex w-full flex-col gap-2 text-center">
                <h2
                  className="font-[family-name:var(--font-instrument-serif)] text-[30px] leading-9 text-white"
                  style={{ fontWeight: 400 }}
                >
                  Create your account
                </h2>
                <p className="font-[family-name:var(--font-instrument-sans)] text-sm leading-5 tracking-[0.14px] text-white/64">
                  Fill the details below to access your account
                </p>
              </div>

              <form
                action={signUpWithEmail}
                className="flex w-full flex-col items-center gap-6"
              >
                <input type="hidden" name="next" value={next} />

                {authError ? (
                  <p
                    className="w-full max-w-[400px] rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-center text-sm text-red-200"
                    role="alert"
                  >
                    {authError}
                  </p>
                ) : null}

                <div className="flex w-full flex-col items-center gap-4">
                  <AuthField
                    icon={User}
                    label="Username"
                    name="username"
                    autoComplete="username"
                  />
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
                    autoComplete="new-password"
                    required
                  />
                  <AuthField
                    icon={Lock}
                    label="Repeat Password"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </div>

                <div className="flex w-full max-w-[400px] flex-col gap-3 px-2">
                  <label className="flex cursor-pointer items-start gap-2 text-left">
                    <input
                      type="checkbox"
                      name="termsAccepted"
                      required
                      className="mt-0.5 size-4 shrink-0 rounded border-0 accent-white"
                    />
                    <span className="font-[family-name:var(--font-instrument-sans)] text-sm leading-5 text-white">
                      I read and accept{" "}
                      <Link
                        href="/auth/sign-up#terms"
                        className="underline underline-offset-2"
                      >
                        all terms of use
                      </Link>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-left">
                    <input
                      type="checkbox"
                      name="promoEmails"
                      className="mt-0.5 size-4 shrink-0 rounded border border-white/64 bg-transparent accent-white"
                    />
                    <span className="font-[family-name:var(--font-instrument-sans)] text-sm leading-5 text-white/64">
                      I want to receive weekly promotional emails
                    </span>
                  </label>
                </div>

                <Button
                  type="submit"
                  className={cn(
                    "h-auto w-full max-w-[400px] rounded-[32px] border-0 px-4 py-2 font-[family-name:var(--font-instrument-sans)] text-sm font-medium leading-6 tracking-[0.14px] text-white",
                    MAGENTA_GRAD,
                  )}
                >
                  Create new account
                </Button>
              </form>

              <div
                id="terms"
                className="max-w-[400px] scroll-mt-24 text-center text-xs leading-5 text-white/45"
              >
                By creating an account you agree to our acceptable use and
                privacy practices described in the terms link above.
              </div>

              <div className="flex w-full max-w-[400px] flex-col items-center border-t border-white pt-5">
                <Link
                  href={`/auth/login?next=${encodeURIComponent(next)}`}
                  className="inline-flex items-center gap-2 rounded-xl px-2 py-1 font-[family-name:var(--font-instrument-sans)] text-sm text-white transition-colors hover:bg-white/10"
                >
                  <LogIn className="size-3.5" aria-hidden />
                  Login to your account
                </Link>
              </div>
            </div>
          </div>
        </div>

        <AdaMarketingPanel />
      </div>
    </div>
  );
}
