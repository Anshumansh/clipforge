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
