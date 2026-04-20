export type ProjectSession = {
  id: string;
  title: string;
  inputContent: string;
  inputType: "url" | "text" | "idea";
  outputText: string | null;
  createdAt: string;
  updatedAt: string;
  /** Raw columns for restoring composer + turns. */
  inputText: string | null;
  inputUrl: string | null;
  generationKind: "clip_package" | "generic";
};

import { autoTitle } from "@/lib/utils";

export type GenerationsApiRow = {
  id: string;
  title: string | null;
  input_text: string | null;
  input_url: string | null;
  output: string;
  type: string;
  created_at: string;
  updated_at: string;
};

function deriveInputType(
  inputText: string,
  inputUrl: string,
): "url" | "text" | "idea" {
  if (inputUrl && !inputText) return "url";
  if (
    inputText &&
    !inputUrl &&
    inputText.length < 120 &&
    inputText.split(/\s+/).filter(Boolean).length <= 18
  ) {
    return "idea";
  }
  return "text";
}

export function projectSessionFromRow(row: GenerationsApiRow): ProjectSession {
  const it = row.input_text?.trim() ?? "";
  const iu = row.input_url?.trim() ?? "";
  const inputContent = it || iu || "";
  const kind =
    row.type === "generic" ? "generic" : ("clip_package" as const);
  const title = row.title?.trim() || autoTitle(inputContent);
  return {
    id: row.id,
    title,
    inputContent,
    inputType: deriveInputType(it, iu),
    outputText: row.output?.trim() ? row.output : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    inputText: row.input_text,
    inputUrl: row.input_url,
    generationKind: kind,
  };
}
