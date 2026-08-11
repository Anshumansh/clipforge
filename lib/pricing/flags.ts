/**
 * Two different kinds of switch, per the brief's staged-rollout requirement
 * (section 13) and profitability-safeguard requirement (section 7) -- kept
 * separate because they answer different questions:
 *
 * - PRICING_V2_ENABLED (env var, deploy-time): "is the new credit engine
 *   live at all?" Off by default. Flipping it on is a deploy, not a live
 *   admin action -- matches the brief's "enable new plans for new customers
 *   only" as a deliberate, reviewed rollout step, not a switch anyone can
 *   flip by accident.
 * - KillSwitch (database, admin-flippable at runtime): "is this specific
 *   feature allowed right now?" Defaults to allowed (enabled=true) for any
 *   feature with no row yet -- these exist for stopping an active cost leak
 *   or abuse pattern immediately, without waiting for a deploy.
 */
import { db } from "@/lib/db";

export function isPricingV2Enabled(): boolean {
  return process.env.PRICING_V2_ENABLED === "true";
}

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
