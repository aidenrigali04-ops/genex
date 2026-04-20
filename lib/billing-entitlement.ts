/** True when the user may spend subscription credits (trial or paid). */
export function isBillingEntitled(
  subscriptionStatus: string | null | undefined,
  unlimitedCredits: boolean | null | undefined,
): boolean {
  if (unlimitedCredits) return true;
  const s = subscriptionStatus ?? "";
  return s === "trialing" || s === "active";
}
