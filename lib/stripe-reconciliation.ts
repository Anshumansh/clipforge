import { getStripe } from "@/lib/stripe";
import { getPlanByPriceId } from "@/lib/plans";
import { db } from "@/lib/db";

export interface ReconciliationIssue {
  userId: string;
  email: string;
  issue: string;
  local: { plan: string; stripePriceId: string | null; stripeSubscriptionId: string | null };
  stripeStatus: string | null;
  stripePriceId: string | null;
  fetchError: string | null;
}

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

/** Read-only comparison of Stripe's real subscription state against what's
 * stored locally -- catches drift the webhook handler should have prevented
 * (a missed/failed event, a manual change in the Stripe dashboard, etc.)
 * rather than assuming the webhook is infallible. Makes no writes; an admin
 * decides what to do with what this finds. */
export async function reconcileSubscriptions(): Promise<{ checked: number; issues: ReconciliationIssue[] }> {
  const users = await db.user.findMany({
    where: { stripeSubscriptionId: { not: null } },
    select: { id: true, email: true, plan: true, stripePriceId: true, stripeSubscriptionId: true },
  });

  const stripe = getStripe();
  const issues: ReconciliationIssue[] = [];

  for (const user of users) {
    try {
      const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId!);
      const item = sub.items.data[0];
      const stripePriceId = item?.price.id ?? null;
      const stripePlan = stripePriceId ? getPlanByPriceId(stripePriceId) : undefined;
      const subIsActive = ACTIVE_STATUSES.has(sub.status);

      let issue: string | null = null;
      if (!subIsActive && user.plan !== "free") {
        issue = `Stripe subscription status is "${sub.status}" but local plan is still "${user.plan}" -- customer.subscription.deleted may have been missed`;
      } else if (subIsActive && stripePlan && stripePlan.id !== user.plan) {
        issue = `Stripe's active price maps to plan "${stripePlan.id}" but local plan is "${user.plan}"`;
      } else if (subIsActive && stripePriceId !== user.stripePriceId) {
        issue = `Stripe price ID "${stripePriceId}" doesn't match local stripePriceId "${user.stripePriceId}"`;
      }

      if (issue) {
        issues.push({
          userId: user.id,
          email: user.email,
          issue,
          local: { plan: user.plan, stripePriceId: user.stripePriceId, stripeSubscriptionId: user.stripeSubscriptionId },
          stripeStatus: sub.status,
          stripePriceId,
          fetchError: null,
        });
      }
    } catch (err) {
      issues.push({
        userId: user.id,
        email: user.email,
        issue: "Could not fetch this subscription from Stripe (deleted object, bad ID, or API error)",
        local: { plan: user.plan, stripePriceId: user.stripePriceId, stripeSubscriptionId: user.stripeSubscriptionId },
        stripeStatus: null,
        stripePriceId: null,
        fetchError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { checked: users.length, issues };
}
