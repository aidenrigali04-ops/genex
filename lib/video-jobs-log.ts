type VideoJobLogFields = Record<string, string | number | boolean | null | undefined>;

/** Single-line JSON logs for grep-friendly production debugging. */
export function logVideoJob(
  event: string,
  fields: VideoJobLogFields = {},
  severity: "info" | "error" = "info",
): void {
  const line = JSON.stringify({
    scope: "video-jobs",
    event,
    t: new Date().toISOString(),
    ...fields,
  });
  if (severity === "error") console.error(line);
  else console.log(line);
}
