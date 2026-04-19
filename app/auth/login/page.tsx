import { Suspense } from "react";

import { AdaLoginView } from "@/components/auth/ada-login-view";

export const metadata = {
  title: "Log in — GenEx",
  description: "Sign in to GenEx",
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-[#0A050F] text-white/60">
          Loading…
        </div>
      }
    >
      <AdaLoginView />
    </Suspense>
  );
}
