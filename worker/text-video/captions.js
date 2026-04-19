import { writeFileSync } from "node:fs";

/** Escape a single subtitle line for ASS (override braces + backslashes). */
function escapeAssLine(line) {
  return String(line ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

const MAX_LINE_CHARS = 22;

/**
 * Wrap caption to at most two lines (~MAX_LINE_CHARS per line).
 * @param {string} caption
 */
function wrapCaptionLines(caption) {
  const words = caption.split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let current = "";

  for (let wi = 0; wi < words.length; wi++) {
    const word = words[wi];
    const candidate = current ? `${current} ${word}` : word;

    if (candidate.length > MAX_LINE_CHARS && current) {
      lines.push(current);
      current = word;
      if (lines.length === 2) {
        current = words.slice(wi).join(" ").trim();
        break;
      }
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  const out = lines.slice(0, 2);
  for (let li = 0; li < out.length; li++) {
    if (out[li].length > MAX_LINE_CHARS) {
      out[li] = `${out[li].slice(0, MAX_LINE_CHARS - 1)}…`;
    }
  }
  return out;
}

/**
 * Build an ASS subtitle file from shot plan timing.
 */
export function buildAssFromShotPlan(shots, outputPath) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,82,&H00FFFFFF,&H000000FF,&H00000000,&H99000000,-1,0,0,0,100,100,1.5,0,1,3.5,2,2,80,80,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  let currentTime = 0;
  const lines = shots.map((shot) => {
    const dur = Number(shot.duration) || 5;
    const caption = String(shot.caption ?? "");

    if (!caption.trim()) {
      currentTime += dur;
      return null;
    }

    const start = formatAssTime(currentTime + 0.3);
    const end = formatAssTime(currentTime + dur - 0.3);
    currentTime += dur;

    const wrapped = wrapCaptionLines(caption.trim());
    const text = wrapped.map((l) => escapeAssLine(l)).join("\\N");

    return `Dialogue: 0,${start},${end},Default,,0,0,0,,{\\an2}${text}`;
  });

  writeFileSync(
    outputPath,
    `${header}${lines.filter(Boolean).join("\n")}\n`,
  );
}

function formatAssTime(seconds) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
