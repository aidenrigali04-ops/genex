import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const EL_KEY = process.env.ELEVENLABS_API_KEY;

/**
 * Generate a voiceover MP3 for the full script (ElevenLabs streaming).
 */
export async function generateVoiceover(script, voiceId, outputPath) {
  if (!EL_KEY) {
    throw new Error("Missing ELEVENLABS_API_KEY");
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
      "xi-api-key": EL_KEY,
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
    const err = await res.text();
    throw new Error(`ElevenLabs error ${res.status}: ${err}`);
  }
  if (!res.body) {
    throw new Error("ElevenLabs: empty body");
  }

  await pipeline(Readable.fromWeb(res.body), createWriteStream(outputPath));
}
