export interface Plan {
  id: "hobby" | "creator" | "business";
  name: string;
  priceId: string | undefined;
  monthlyCredits: number;
  priceLabel: string;
}

export const PLANS: Plan[] = [
  {
    id: "hobby",
    name: "Hobby",
    priceId: process.env.STRIPE_PRICE_HOBBY,
    monthlyCredits: 300,
    priceLabel: "$19.99/mo",
  },
  {
    id: "creator",
    name: "Creator",
    priceId: process.env.STRIPE_PRICE_CREATOR,
    monthlyCredits: 600,
    priceLabel: "$26.88/mo",
  },
  {
    id: "business",
    name: "Business",
    priceId: process.env.STRIPE_PRICE_BUSINESS,
    monthlyCredits: 2500,
    priceLabel: "$44.99/mo",
  },
];

export function getPlanById(id: string) {
  return PLANS.find((p) => p.id === id);
}

export function getPlanByPriceId(priceId: string) {
  return PLANS.find((p) => p.priceId === priceId);
}

/** Voice cloning is CPU/memory-heavy on the render VPS (see OPERATIONS.md) —
 * reserved for the Business plan, same tier gate as multi-format export. */
export function canUseVoiceClone(plan: string): boolean {
  return plan === "business";
}

/** Brand kits can be configured on any plan (see app/api/brand-kit) so a
 * user can set one up in advance, but only actually applied to a render on
 * the Business plan -- same tier gate as voice cloning and multi-format. */
export function canUseBrandKit(plan: string): boolean {
  return plan === "business";
}

/** API access (item 10, MCP server) -- advertised on the pricing page as a
 * Business-plan feature. Checked both at key-creation time and on every
 * request (lib/api-auth.ts), so a downgraded account's existing keys stop
 * working immediately rather than at next renewal. */
export function canUseApiAccess(plan: string): boolean {
  return plan === "business";
}

/** Team workspaces (item 12) -- creating one is a Business-plan feature,
 * since invited members spend from the owner's credit pool. Already-joined
 * members can stay in a workspace regardless of their own plan (they're
 * not the one being billed). */
export function canCreateWorkspace(plan: string): boolean {
  return plan === "business";
}

/** Repurpose (long-form → highlight clips) -- available on any paid plan.
 * Free accounts cannot access this workflow. */
export function canUseRepurpose(plan: string): boolean {
  return plan === "hobby" || plan === "creator" || plan === "business";
}

/** UGC ad generator -- Creator and Business plans only.
 * Hobby accounts get the script-to-video workflow only. */
export function canUseUgc(plan: string): boolean {
  return plan === "creator" || plan === "business";
}
