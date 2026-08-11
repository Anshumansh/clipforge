import { NextResponse } from "next/server";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { getStripe } from "@/lib/stripe";
import { getPlanByPriceId, getPlanById } from "@/lib/plans";
import { grantCredits } from "@/lib/pricing/ledger";
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

  // Idempotent event processing (pricing overhaul brief, section 8/9):
  // Stripe retries any delivery that doesn't get a fast 2xx, so the same
  // event can arrive more than once. The event id itself is the row's
  // primary key -- a duplicate delivery's insert hits the unique
  // constraint and is treated as already-handled, without re-running any
  // handler logic below (some of which, like checkout.session.completed's
  // credit grant, would otherwise be safe to replay only by coincidence).
  try {
    await db.stripeWebhookEvent.create({
      data: { id: event.id, type: event.type, payloadSummary: JSON.stringify({ type: event.type }).slice(0, 500) },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    throw err;
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

        // Update the user's plan and billing info, then write an audit-trail
        // ledger entry for the initial subscription credit grant. The credits
        // field is SET (not incremented) to the plan allocation — so the ledger
        // entry records what was granted, not the net balance change.
        await db.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: userId },
            data: {
              plan: plan?.id ?? planId,
              credits: plan?.monthlyCredits ?? undefined,
              stripeSubscriptionId: subscription.id,
              stripePriceId: priceId,
              stripeCurrentPeriodEnd: item ? new Date(item.current_period_end * 1000) : undefined,
              billingIssue: null,
            },
          });

          if (plan) {
            await tx.creditLedgerEntry.create({
              data: {
                userId,
                type: "monthly_grant",
                delta: plan.monthlyCredits,
                balanceAfter: plan.monthlyCredits,
                idempotencyKey: `stripe:initial-grant:${event.id}`,
                note: `Initial ${plan.id} subscription grant`,
              },
            });
          }
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
          // Monthly renewal: SET credits to plan allocation (same as initial grant)
          // and write an audit ledger entry inside the same transaction.
          await db.$transaction(async (tx) => {
            await tx.user.update({
              where: { id: user.id },
              data: { credits: plan.monthlyCredits, plan: plan.id, billingIssue: null },
            });
            await tx.creditLedgerEntry.create({
              data: {
                userId: user.id,
                type: "monthly_grant",
                delta: plan.monthlyCredits,
                balanceAfter: plan.monthlyCredits,
                idempotencyKey: `stripe:renewal:${event.id}`,
                note: `Monthly renewal grant for ${plan.id}`,
              },
            });
          });
        }
      }
      break;
    }

    // Stripe's own dunning retries a failed renewal several times before
    // giving up -- this just flags it for a billing-page banner. Plan/credits
    // are untouched here; a permanent failure eventually shows up as its own
    // customer.subscription.deleted event, which does downgrade to free.
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.customer) {
        const user = await findUserForCustomer(invoice.customer as string);
        if (user) {
          await db.user.update({ where: { id: user.id }, data: { billingIssue: "past_due" } });
        }
      }
      break;
    }

    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const stripe = getStripe();
      const charge =
        typeof dispute.charge === "string" ? await stripe.charges.retrieve(dispute.charge) : dispute.charge;
      const customerId = typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
      if (customerId) {
        const user = await findUserForCustomer(customerId);
        if (user) {
          await db.user.update({ where: { id: user.id }, data: { billingIssue: "disputed" } });
          console.error(`[stripe webhook] Dispute opened for user ${user.id} (${user.email}), charge ${dispute.charge}`);
        }
      }
      break;
    }

    // Rare (usually only via manual action in the Stripe dashboard), but a
    // dangling stripeCustomerId/stripeSubscriptionId after the customer
    // itself is gone would break the next checkout/portal attempt.
    case "customer.deleted": {
      const customer = event.data.object as Stripe.Customer;
      const user = await findUserForCustomer(customer.id);
      if (user) {
        await db.user.update({
          where: { id: user.id },
          data: {
            plan: "free",
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            stripePriceId: null,
            billingIssue: null,
          },
        });
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const user = await findUserForCustomer(subscription.customer as string);
      const item = subscription.items.data[0];
      const priceId = item?.price.id;
      const newPlan = priceId ? getPlanByPriceId(priceId) : undefined;
      if (user) {
        await db.user.update({
          where: { id: user.id },
          data: {
            plan: newPlan?.id ?? user.plan,
            stripePriceId: priceId,
            stripeCurrentPeriodEnd: item ? new Date(item.current_period_end * 1000) : undefined,
          },
        });

        // Grant the positive credit DIFFERENCE on an upgrade so the user
        // receives the new tier's allocation immediately (pro-rated by diff,
        // not a full reset — that comes at renewal via invoice.paid).
        // Rules: never reduce on downgrade; exact-once via grantCredits' own
        // idempotency key (second layer on top of the StripeWebhookEvent dedup).
        if (newPlan && newPlan.id !== user.plan) {
          const oldPlan = getPlanById(user.plan);
          const creditDiff = Math.max(0, newPlan.monthlyCredits - (oldPlan?.monthlyCredits ?? 0));
          if (creditDiff > 0) {
            await grantCredits({
              userId: user.id,
              amount: creditDiff,
              type: "upgrade_grant",
              idempotencyKey: `stripe:upgrade:${event.id}`,
              note: `Plan upgrade: ${user.plan} → ${newPlan.id} (+${creditDiff} credits)`,
            }).catch((e) =>
              console.error("[stripe webhook] upgrade credit grant failed:", e instanceof Error ? e.message : e)
            );
          }
        }
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
