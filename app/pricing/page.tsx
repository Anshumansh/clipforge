import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Reveal, RevealGroup, RevealItem } from "@/components/reveal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SubscribeButton } from "@/components/subscribe-button";
import { Check } from "lucide-react";
import {
  getPublicPlanConfigs,
  isPurchasablePlanId,
} from "@/lib/pricing/plan-config";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple Clipforge pricing for creators, brands and small teams.",
};

const plans = getPublicPlanConfigs();

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; canceled?: string }>;
}) {
  const query = await searchParams;
  const selectedPlan = isPurchasablePlanId(query.plan ?? "") ? query.plan : null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="ambient-glow relative flex-1 px-6 py-20">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Simple plans</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight">Start free. Upgrade when you are publishing consistently.</h1>
            <p className="mt-4 text-muted-foreground">
              One credit balance works across Idea-to-video, Repurpose and UGC. The exact price is shown before
              generation, failed jobs are refunded, and paid plans can be managed through Stripe.
            </p>
          </div>
        </Reveal>

        {selectedPlan && (
          <div className="mx-auto mt-8 max-w-2xl rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-center text-sm">
            Your account is ready. Continue with the <span className="font-semibold capitalize">{selectedPlan}</span>{" "}
            plan below.
          </div>
        )}
        {query.canceled && (
          <div className="mx-auto mt-8 max-w-2xl rounded-xl border border-border bg-card/70 px-4 py-3 text-center text-sm text-muted-foreground">
            Checkout was canceled. Nothing was charged; choose a plan whenever you are ready.
          </div>
        )}

        <RevealGroup className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <RevealItem key={plan.planId} className="h-full">
              <div
                id={`plan-${plan.planId}`}
                className={plan.highlighted || selectedPlan === plan.planId ? "glow-ring h-full scroll-mt-24" : "h-full scroll-mt-24"}
              >
                <Card
                  className={
                    "flex h-full flex-col border-transparent bg-card/90 transition-transform duration-200 hover:-translate-y-1" +
                    (plan.highlighted ? " shadow-lg shadow-primary/10" : "")
                  }
                >
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between font-display">
                      <span>{plan.displayName}</span>
                      {plan.highlighted && (
                        <span
                          aria-label=", Most popular"
                          className="rounded-full bg-gradient-to-r from-[hsl(262_83%_66%)] to-[hsl(316_80%_62%)] px-2 py-0.5 text-xs font-medium text-white"
                        >
                          Most popular
                        </span>
                      )}
                    </CardTitle>
                    <CardDescription>{plan.description}</CardDescription>
                    <div className="pt-4">
                      <span className="font-display text-3xl font-bold">
                        ${plan.monthlyPriceUsd.toFixed(plan.monthlyPriceUsd % 1 === 0 ? 0 : 2)}
                      </span>
                      {plan.planId !== "free" && <span className="text-muted-foreground">/month</span>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {plan.monthlyCredits} {plan.oneTimeCreditsOnly ? "included credits" : "credits per month"}
                    </p>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col">
                    <ul className="flex-1 space-y-2.5 text-sm">
                      {plan.marketingFeatures.map((feature) => (
                        <li key={feature} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    {isPurchasablePlanId(plan.planId) ? (
                      <div className="mt-8">
                        <SubscribeButton plan={plan.planId} variant={plan.highlighted ? "default" : "outline"}>
                          {plan.cta}
                        </SubscribeButton>
                      </div>
                    ) : (
                      <Button asChild className="mt-8 w-full" variant="outline">
                        <Link href="/register">{plan.cta}</Link>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </div>
            </RevealItem>
          ))}
        </RevealGroup>

        <div className="mx-auto mt-10 max-w-3xl rounded-xl border border-border/70 bg-card/60 px-5 py-4 text-center text-sm text-muted-foreground">
          Subscriptions renew automatically until canceled. Taxes may apply at checkout. Existing Hobby subscribers
          keep their current plan and can manage it from Billing.
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
