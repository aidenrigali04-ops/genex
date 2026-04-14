import { ChatPanel } from "@/components/chat-panel";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="max-w-lg text-center">
        <h1 className="text-2xl font-semibold tracking-tight">genex</h1>
        <p className="mt-2 text-muted-foreground text-sm">
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
      </div>
      <ChatPanel />
    </div>
  );
}
