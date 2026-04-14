import Link from "next/link";

import { signInWithGoogle } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type LoginPageProps = {
  searchParams: Promise<{
    next?: string;
    authError?: string;
  }>;
};

function safeNextParam(raw: string | undefined, fallback: string) {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeNextParam(params.next, "/dashboard");

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Use Google to access the dashboard and save generations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {params.authError ? (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {params.authError}
            </p>
          ) : null}
          <form action={signInWithGoogle} className="space-y-3">
            <input type="hidden" name="next" value={next} />
            <Button type="submit" className="w-full">
              Continue with Google
            </Button>
          </form>
          <p className="text-muted-foreground text-center text-xs">
            <Link href="/" className="underline-offset-4 hover:underline">
              Back to home
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
