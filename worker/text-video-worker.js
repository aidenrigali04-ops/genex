/**
 * Standalone text → MP4 worker (optional). Same pipeline as main worker.js tick.
 * Default `npm run worker` already runs text-video jobs via worker.js.
 */

import { createClient } from "@supabase/supabase-js";

import { loadGenexWorkerEnv } from "./load-env.js";
import { isPexelsConfigured } from "./resolve-pexels-key.js";

loadGenexWorkerEnv(import.meta.url);

const POLL_MS = 5000;

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error(
    "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY",
  );
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { claimNextTextVideoJob, processTextVideoJob } = await import(
  "./text-video-job-runner.js",
);

async function verifySupabaseServiceRole() {
  const { error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });
  if (error) {
    console.error("[text-video-worker] service_role check failed:", error.message);
    console.error(
      "[text-video-worker] Use SUPABASE_SERVICE_ROLE_KEY (service_role JWT), not the anon key.",
    );
    throw error;
  }
}

async function poll() {
  const job = await claimNextTextVideoJob(supabase);
  if (job) {
    await processTextVideoJob(supabase, job);
  }
}

console.log("[text-video-worker] Started, polling every", POLL_MS, "ms");
console.log("[text-video-worker] text-video keys", {
  pexels: isPexelsConfigured(),
  elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
  openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
});

await verifySupabaseServiceRole();
setInterval(() => void poll().catch(console.error), POLL_MS);
void poll().catch(console.error);
