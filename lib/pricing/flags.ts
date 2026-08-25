/**
 * Runtime profitability and abuse kill switches. Pricing no longer has a
 * second environment-switched catalogue: one canonical plan configuration
 * is always used by UI, Stripe and feature gates.
 */
import { db } from "@/lib/db";

export type KillSwitchFeature = "global" | "demo" | "voice_clone" | "4k_export" | "repurpose" | "social_publishing";

/** No row for a feature means it has never been touched -- treated as
 * enabled (allowed), since these are emergency OFF switches, not opt-in
 * gates. An admin creates/flips a row only to actively stop something. */
export async function isFeatureAllowed(feature: KillSwitchFeature): Promise<boolean> {
  const [global, specific] = await Promise.all([
    feature === "global" ? null : db.killSwitch.findUnique({ where: { feature: "global" } }),
    db.killSwitch.findUnique({ where: { feature } }),
  ]);

  if (global && !global.enabled) return false; // global kill switch overrides every specific one
  if (specific && !specific.enabled) return false;
  return true;
}

export async function setKillSwitch(
  feature: KillSwitchFeature,
  enabled: boolean,
  updatedByUserId: string,
  reason?: string
): Promise<void> {
  await db.killSwitch.upsert({
    where: { feature },
    create: { feature, enabled, updatedByUserId, reason },
    update: { enabled, updatedByUserId, reason },
  });
}
