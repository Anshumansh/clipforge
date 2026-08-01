export interface Plan {
  id: "creator" | "business";
  name: string;
  priceId: string | undefined;
  monthlyCredits: number;
  priceLabel: string;
}

export const PLANS: Plan[] = [
  {
    id: "creator",
    name: "Creator",
    priceId: process.env.STRIPE_PRICE_CREATOR,
    monthlyCredits: 600,
    priceLabel: "$29/mo",
  },
  {
    id: "business",
    name: "Business",
    priceId: process.env.STRIPE_PRICE_BUSINESS,
    monthlyCredits: 2500,
    priceLabel: "$99/mo",
  },
];

export function getPlanById(id: string) {
  return PLANS.find((p) => p.id === id);
}

export function getPlanByPriceId(priceId: string) {
  return PLANS.find((p) => p.priceId === priceId);
}
