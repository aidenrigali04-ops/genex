import Link from "next/link";

import { ChatPanel } from "@/components/chat-panel";
import {
  signInWithEmail,
  signInWithGoogle,
  signOut,
  signUpWithEmail,
} from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

type HomeProps = {
  searchParams: Promise<{
    authError?: string;
    authSuccess?: string;
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="max-w-lg text-center space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">genex</h1>
        <p className="mt-2 text-muted-foreground text-sm">
          <Link
            href={user ? "/dashboard" : "/login?next=%2Fdashboard"}
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Content repurposing dashboard
          </Link>
          {" · "}
          <Link
            href="/login"
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
          {" · "}
          Next.js with shadcn/ui, Supabase client helpers, and the Vercel AI SDK
          (OpenAI). Copy{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            .env.example
          </code>{" "}
          to{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            .env.local
          </code>
          .
        </p>
        {params.authError ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive">
            {params.authError}
          </p>
        ) : null}
        {params.authSuccess ? (
          <p className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-left text-sm text-green-700 dark:text-green-400">
            {params.authSuccess}
          </p>
        ) : null}
      </div>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
        {user ? (
          <div className="space-y-3">
            <p className="text-sm">
              Signed in as <span className="font-medium">{user.email}</span>
            </p>
            <form action={signOut}>
              <Button type="submit" variant="secondary">
                Sign out
              </Button>
            </form>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-sm font-medium">Supabase Auth</h2>
            <form action={signInWithGoogle}>
              <input type="hidden" name="next" value="/" />
              <Button type="submit" className="w-full">
                Continue with Google
              </Button>
            </form>
            <div className="text-xs text-muted-foreground">or email + password</div>
            <form action={signInWithEmail} className="space-y-2">
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring/50 focus-visible:ring-[3px]"
                type="email"
                name="email"
                placeholder="you@example.com"
                required
              />
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring/50 focus-visible:ring-[3px]"
                type="password"
                name="password"
                placeholder="Password"
                minLength={6}
                required
              />
              <Button type="submit" className="w-full">
                Sign in
              </Button>
            </form>
            <form action={signUpWithEmail}>
              <div className="grid gap-2">
                <input
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring/50 focus-visible:ring-[3px]"
                  type="email"
                  name="email"
                  placeholder="New account email"
                  required
                />
                <input
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring/50 focus-visible:ring-[3px]"
                  type="password"
                  name="password"
                  placeholder="Create password (min 6)"
                  minLength={6}
                  required
                />
                <Button type="submit" variant="outline" className="w-full">
                  Create account
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
      <ChatPanel />
    </div>
  );
}
