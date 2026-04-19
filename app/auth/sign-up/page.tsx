import { Suspense } from "react";

import { AdaSignUpView } from "@/components/auth/ada-sign-up-view";

export const metadata = {
  title: "Sign up — GenEx",
  description: "Create your GenEx account",
};

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-[#0A050F] text-white/60">
          Loading…
        </div>
      }
    >
      <AdaSignUpView />
    </Suspense>
  );
}
