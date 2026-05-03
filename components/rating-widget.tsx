"use client";

import { useState } from "react";

export function RatingWidget({
  jobId,
  generationId,
  kind,
  variant = "default",
  compact = false,
}: {
  jobId?: string;
  generationId?: string;
  kind: "video" | "text";
  variant?: "default" | "adaKit";
  compact?: boolean;
}) {
  const [rated, setRated] = useState<"up" | "down" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const kit = variant === "adaKit";

  const submit = async (rating: "up" | "down") => {
    if (rated || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/rating", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, generationId, rating, kind }),
      });
      if (!res.ok) return;
      setRated(rating);
    } catch {
      /* silent */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${compact ? "text-xs" : "text-sm"} ${
        kit ? "text-white/45" : "text-ada-secondary"
      }`}
    >
      <span>Useful?</span>
      <button
        type="button"
        onClick={() => void submit("up")}
        className={`rounded-lg px-3 py-1.5 border transition-colors ${
          rated === "up"
            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
            : kit
              ? "border-white/10 hover:border-white/20 hover:text-white/70"
              : "border-ada-border hover:border-ada-border-active hover:text-ada-primary"
        }`}
        disabled={!!rated || submitting}
      >
        👍
      </button>
      <button
        type="button"
        onClick={() => void submit("down")}
        className={`rounded-lg px-3 py-1.5 border transition-colors ${
          rated === "down"
            ? "border-red-500/40 bg-red-500/15 text-red-400"
            : kit
              ? "border-white/10 hover:border-white/20 hover:text-white/70"
              : "border-ada-border hover:border-ada-border-active hover:text-ada-primary"
        }`}
        disabled={!!rated || submitting}
      >
        👎
      </button>
      {rated ? (
        <span className={kit ? "text-white/35" : "text-ada-disabled"}>
          Thanks — this helps improve outputs
        </span>
      ) : null}
    </div>
  );
}
