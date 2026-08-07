import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SubscribeButton } from "@/components/subscribe-button";
import { Check } from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple, credit-based pricing for Clipforge — Free, Hobby, Creator, and Business plans.",
};

const plans = [
  {
    name: "Free",
    planId: null,
    price: "$0",
    credits: "50 credits / month",
    description: "Try the full pipeline before you commit.",
    features: [
      "~5 short videos / month",
      "Full pipeline — script, voiceover, captions, b-roll",
      "Watermarked exports",
      "720p export",
      "No credit card required",
    ],
    cta: "Start free",
    highlighted: false,
  },
  {
    name: "Hobby",
    planId: "hobby" as const,
    price: "$19.99",
    credits: "300 credits / month",
    description: "For casual creators just getting started.",
    features: [
      "~30 short videos / month",
      "No watermark",
      "1080p export",
      "AI hook-score ranking on every clip",
      "Standard render queue",
    ],
    cta: "Start Hobby plan",
    highlighted: false,
  },
  {
    name: "Creator",
    planId: "creator" as const,
    price: "$26.88",
    credits: "600 credits / month",
    description: "For creators posting daily shorts.",
    features: [
      "~60 short videos / month",
      "No watermark",
      "1080p export",
      "Repurpose long-form uploads",
      "AI hook-score ranking on every clip",
      "Priority render queue",
    ],
    cta: "Start Creator plan",
    highlighted: true,
  },
  {
    name: "Business",
    planId: "business" as const,
    price: "$44.99",
    credits: "2,500 credits / month",
    description: "For agencies and brands running UGC ad campaigns.",
    features: [
      "~250 short videos / month",
      "UGC / avatar ad generation",
      "4K export",
      "Multi-format export (9:16, 1:1, 16:9)",
      "Team seats",
      "API access (soon)",
    ],
    cta: "Start Business plan",
    highlighted: false,
  },
];

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1 px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-bold tracking-tight">Simple, credit-based pricing</h1>
          <p className="mt-4 text-muted-foreground">
            One credit ≈ one minute of rendered video. Upgrade, downgrade, or cancel any time.
          </p>
        </div>
        <div className="mx-auto mt-14 grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => (
            <Card key={plan.name} className={plan.highlighted ? "border-primary shadow-lg shadow-primary/10" : ""}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {plan.name}
                  {plan.highlighted && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                      Popular
                    </span>
                  )}
                </CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <div className="pt-4">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground">/mo</span>
                </div>
                <p className="text-sm text-muted-foreground">{plan.credits}</p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {plan.planId ? (
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
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
