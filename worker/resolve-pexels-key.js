/**
 * Single source of truth for Pexels API key resolution (worker + any script that imports this).
 * Pexels docs: send the API key in the Authorization header (no "Bearer" prefix).
 */

const ENV_KEYS = [
  "PEXELS_API_KEY",
  "PEXELS_ACCESS_TOKEN",
  "PEXEL_API_KEY",
  "PEXELS_KEY",
];

export function resolvePexelsApiKey() {
  for (const k of ENV_KEYS) {
    const raw = process.env[k];
    const t = typeof raw === "string" ? raw.trim() : "";
    if (t) return t;
  }
  return "";
}

export function isPexelsConfigured() {
  return resolvePexelsApiKey().length > 0;
}
