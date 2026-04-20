import type { SupabaseClient } from "@supabase/supabase-js";

/** Append-only markdown journal for clip runs (second-brain / audit trail). */
export async function appendClipVaultEntry(
  supabase: SupabaseClient,
  args: {
    userId: string;
    jobId: string;
    title: string;
    scriptExcerpt: string;
    status: string;
    extra?: string;
  },
): Promise<void> {
  const body = [
    `## ${args.title}`,
    `Job: \`${args.jobId}\``,
    `Status: ${args.status}`,
    "",
    "### Script (excerpt)",
    "```",
    args.scriptExcerpt.slice(0, 2000),
    "```",
    args.extra ? `\n${args.extra}` : "",
    "",
    `---\n_Generated ${new Date().toISOString()}_`,
  ].join("\n");

  const { error } = await supabase.from("clip_vault_entries").insert({
    user_id: args.userId,
    job_id: args.jobId,
    body,
  });

  if (error) {
    console.warn("[clip-vault] insert failed:", error.message);
  }
}
