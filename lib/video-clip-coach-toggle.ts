/**
 * Ada “Clip my video” kit: unified coach is a pure function of embed mode + user toggle.
 * Keeps composer UI dumb — no coach surface unless both are true.
 */
export function shouldUseUnifiedVideoClipCoach(
  embedClipCoach: boolean,
  clipCoachEnabled: boolean,
): boolean {
  return Boolean(embedClipCoach && clipCoachEnabled);
}
