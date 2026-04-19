import { writeFileSync } from "node:fs";

/**
 * Build an ASS subtitle file from shot plan timing.
 */
export function buildAssFromShotPlan(shots, outputPath) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H000000FF,&H00000000,&HCC000000,-1,0,0,0,100,100,0.5,0,1,3,1.5,2,60,60,180,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  let currentTime = 0;
  const lines = shots.map((shot) => {
    const dur = Number(shot.duration) || 5;
    const start = formatAssTime(currentTime + 0.3);
    const end = formatAssTime(currentTime + dur - 0.3);
    currentTime += dur;

    const caption = String(shot.caption ?? "");
    const words = caption.split(/\s+/).filter(Boolean);
    const wrapped = [];
    let line = "";
    for (const word of words) {
      const next = (line + " " + word).trim();
      if (next.length > 28 && line) {
        wrapped.push(line.trim());
        line = word;
      } else {
        line = next;
      }
    }
    if (line) wrapped.push(line.trim());
    const text = wrapped.join("\\N");

    return `Dialogue: 0,${start},${end},Default,,0,0,0,,{\\an2}${text}`;
  });

  writeFileSync(outputPath, `${header}${lines.join("\n")}\n`);
}

function formatAssTime(seconds) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
