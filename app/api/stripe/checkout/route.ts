import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { getPlanConfig, getStripePriceId } from "@/lib/pricing/plan-config";
import { getPublicAppOrigin } from "@/lib/public-app-url";

const schema = z.object({ plan: z.enum(["creator", "business"]) });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });

  const plan = getPlanConfig(parsed.data.plan);
  const priceId = getStripePriceId(parsed.data.plan);
  if (!plan?.purchasable || !priceId) {
    return NextResponse.json({ error: "This plan isn't configured yet" }, { status: 500 });
  }

  try {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const stripe = getStripe();
    const origin = getPublicAppOrigin(req.url);

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await db.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard/billing?success=1`,
      cancel_url: `${origin}/pricing?canceled=1&plan=${plan.planId}#plan-${plan.planId}`,
      metadata: { userId: user.id, plan: plan.planId },
      subscription_data: { metadata: { userId: user.id, plan: plan.planId } },
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    console.error("Unable to create Stripe checkout session", error);
    return NextResponse.json(
      { error: "Checkout is temporarily unavailable. Please try again in a moment." },
      { status: 503 }
    );
  }
}
