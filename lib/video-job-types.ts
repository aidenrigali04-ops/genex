export type VideoJobStatus =
  | "queued"
  | "analyzing"
  | "generating"
  | "complete"
  | "failed";

export type VideoVariationItem = {
  url: string;
  label: string;
};

export function videoJobStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "analyzing":
      return "Analyzing video";
    case "generating":
      return "Generating variations";
    case "complete":
      return "Done";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}
