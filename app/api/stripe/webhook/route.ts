import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getPlanByPriceId } from "@/lib/plans";
import { db } from "@/lib/db";

export const runtime = "nodejs";

async function findUserForCustomer(customerId: string) {
  return db.user.findUnique({ where: { stripeCustomerId: customerId } });
}

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, signature ?? "", webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const planId = session.metadata?.plan;
      if (userId && planId && session.subscription) {
        const stripe = getStripe();
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const item = subscription.items.data[0];
        const priceId = item?.price.id;
        const plan = priceId ? getPlanByPriceId(priceId) : undefined;

        await db.user.update({
          where: { id: userId },
          data: {
            plan: plan?.id ?? planId,
            credits: plan?.monthlyCredits ?? undefined,
            stripeSubscriptionId: subscription.id,
            stripePriceId: priceId,
            stripeCurrentPeriodEnd: item ? new Date(item.current_period_end * 1000) : undefined,
          },
        });
      }
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.customer && invoice.billing_reason === "subscription_cycle") {
        const user = await findUserForCustomer(invoice.customer as string);
        const price = invoice.lines.data[0]?.pricing?.price_details?.price;
        const priceId = typeof price === "string" ? price : price?.id;
        const plan = priceId ? getPlanByPriceId(priceId) : undefined;
        if (user && plan) {
          await db.user.update({
            where: { id: user.id },
            data: { credits: plan.monthlyCredits, plan: plan.id },
          });
        }
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const user = await findUserForCustomer(subscription.customer as string);
      const item = subscription.items.data[0];
      const priceId = item?.price.id;
      const plan = priceId ? getPlanByPriceId(priceId) : undefined;
      if (user) {
        await db.user.update({
          where: { id: user.id },
          data: {
            plan: plan?.id ?? user.plan,
            stripePriceId: priceId,
            stripeCurrentPeriodEnd: item ? new Date(item.current_period_end * 1000) : undefined,
          },
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const user = await findUserForCustomer(subscription.customer as string);
      if (user) {
        await db.user.update({
          where: { id: user.id },
          data: { plan: "free", stripeSubscriptionId: null, stripePriceId: null },
        });
      }
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
