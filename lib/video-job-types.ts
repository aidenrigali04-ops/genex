export type VideoJobStatus =
  | "queued"
  | "processing"
  | "transcribing"
  | "planning"
  | "generating"
  | "analyzing"
  | "complete"
  | "failed";

export type VideoVariationItem = {
  url: string;
  label: string;
  variation_number?: number;
  style_note?: string;
};

export function videoJobStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "processing":
      return "Processing";
    case "transcribing":
    case "analyzing":
      return "Transcribing";
    case "planning":
      return "Planning";
    case "generating":
      return "Generating";
    case "complete":
      return "Done";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}
