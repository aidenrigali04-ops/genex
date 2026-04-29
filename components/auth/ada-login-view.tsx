"use client";

import { useSearchParams } from "next/navigation";

import { AdaMarketingPanel } from "@/components/auth/ada-sign-up-view";
import { AdaLoginPanel } from "@/components/auth/ada-login-panel";
import { AdaFigmaAmbientBackground } from "@/components/genex/ada-figma-dashboard";

export function AdaLoginView() {
  const searchParams = useSearchParams();
  const authError = searchParams.get("authError");
  const authSuccess = searchParams.get("authSuccess");
  const next = searchParams.get("next") ?? "/";

  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-[#0A050F] text-white">
      <AdaFigmaAmbientBackground />

      <div className="relative z-[1] flex min-h-dvh flex-col lg:flex-row">
        <div className="flex w-full flex-1 flex-col items-center gap-8 px-6 py-10 sm:px-10 lg:max-w-[756px] lg:justify-center lg:py-10">
          <AdaLoginPanel
            next={next}
            authError={authError}
            authSuccess={authSuccess}
          />
        </div>

        <AdaMarketingPanel />
      </div>
    </div>
  );
}
