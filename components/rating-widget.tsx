"use client";

import { useState } from "react";

export function RatingWidget({
  jobId,
  generationId,
  kind,
}: {
  jobId?: string;
  generationId?: string;
  kind: "video" | "text";
}) {
  const [rated, setRated] = useState<"up" | "down" | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    <div className="flex flex-wrap items-center gap-3 text-sm text-white/40">
      <span>Was this useful?</span>
      <button
        type="button"
        onClick={() => void submit("up")}
        className={`rounded-lg px-3 py-1.5 border transition-colors ${
          rated === "up"
            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
            : "border-white/10 hover:border-white/20 hover:text-white/60"
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
            : "border-white/10 hover:border-white/20 hover:text-white/60"
        }`}
        disabled={!!rated || submitting}
      >
        👎
      </button>
      {rated ? (
        <span className="text-white/30">Thanks — this helps improve outputs</span>
      ) : null}
    </div>
  );
}
