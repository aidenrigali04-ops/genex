import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

function elevenLabsKey() {
  return process.env.ELEVENLABS_API_KEY?.trim() ?? "";
}

/**
 * @param {Response} res
 * @param {string} rawBody
 */
function formatElevenLabsHttpError(res, rawBody) {
  const status = res.status;
  let snippet = rawBody.replace(/\s+/g, " ").slice(0, 280);
  try {
    const j = JSON.parse(rawBody);
    const d = j?.detail;
    const code =
      typeof d === "object" && d != null ? String(d.status ?? "") : "";
    const msg =
      typeof d === "object" && d != null && typeof d.message === "string"
        ? d.message
        : typeof d === "string"
          ? d
          : "";
    if (
      status === 401 &&
      (code === "detected_unusual_activity" ||
        /unusual activity|abuse|free tier|proxy|vpn/i.test(msg))
    ) {
      return (
        "ElevenLabs declined this request (401: unusual activity / free tier). " +
        "Cloud worker IPs (Railway, Fly, etc.) and VPNs often require a paid ElevenLabs plan. " +
        "HTTPS to api.elevenlabs.io is fine—this is account/IP policy, not your app transport."
      );
    }
    if (msg) snippet = msg.replace(/\s+/g, " ").slice(0, 280);
  } catch {
    /* keep snippet */
  }
  return `ElevenLabs HTTP ${status}: ${snippet}`;
}

/**
 * Generate a voiceover MP3 for the full script (ElevenLabs streaming).
 * Uses HTTPS to https://api.elevenlabs.io only; never log the API key.
 */
export async function generateVoiceover(script, voiceId, outputPath) {
  const key = elevenLabsKey();
  if (!key) {
    throw new Error(
      "Missing ELEVENLABS_API_KEY. Set it in worker/.env or repo root .env.local, or host env.",
    );
  }
  const id = voiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const outputFormat =
    process.env.ELEVENLABS_OUTPUT_FORMAT?.trim() || "mp3_44100_128";
  const params = new URLSearchParams({ output_format: outputFormat });
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    id,
  )}/stream?${params.toString()}`;

  const text = script.trim().slice(0, 9500);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      Accept: "audio/mpeg",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const raw = await res.text();
    throw new Error(formatElevenLabsHttpError(res, raw));
  }
  if (!res.body) {
    throw new Error("ElevenLabs: empty body");
  }

  await pipeline(Readable.fromWeb(res.body), createWriteStream(outputPath));
}
