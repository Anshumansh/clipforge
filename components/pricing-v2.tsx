"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PLAN_CONFIGS, type StandardPlanId, type PlanFeatureConfig } from "@/lib/pricing/plan-config";
import { creditsForStandardVideo } from "@/lib/pricing/credit-calculator";

const STANDARD_VIDEO_BASE_CREDITS = creditsForStandardVideo(45); // the cheapest priced band (30-45s = 10 credits)

const PLAN_ORDER: StandardPlanId[] = ["free", "starter", "creator", "pro", "business"];

interface CompetitorRow {
  competitor: string;
  planName: string;
  priceUsd: number;
  billingPeriod: string;
  sourceUrl: string;
  verifiedAt: string; // ISO string, already filtered to non-stale by the server
}

const COMPETITOR_DISPLAY_NAMES: Record<string, string> = {
  opusclip: "OpusClip",
  revid: "Revid.ai",
  klap: "Klap",
  vizard: "Vizard",
};

function restrictionsFor(plan: PlanFeatureConfig): string[] {
  const restrictions: string[] = [];
  if (!plan.workflows.repurpose) restrictions.push("No long-form repurposing");
  if (!plan.workflows.ugc) restrictions.push("No UGC-style ads");
  if (!plan.voiceCloning) restrictions.push("No voice cloning");
  if (plan.maxResolution !== "4k") restrictions.push("No 4K export");
  if (plan.apiAccess === "none") restrictions.push("No API/MCP access");
  if (plan.seatsIncluded <= 1) restrictions.push("No team seats");
  if (plan.watermark) restrictions.push("Watermarked exports");
  if (plan.maxDurationSec) restrictions.push(`Max ${plan.maxDurationSec}s per video`);
  return restrictions;
}

export function PricingV2({ competitors }: { competitors: CompetitorRow[] }) {
  const [annual, setAnnual] = useState(false);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center text-sm text-amber-200">
        Preview of the new pricing structure — not yet live for customers. Checkout on this page is disabled
        pending owner approval (see STRIPE_PRODUCT_MAPPING.md and PRICING_DEPLOYMENT_CHECKLIST.md).
      </div>

      <div className="mb-10 flex items-center justify-center gap-3">
        <span className={!annual ? "font-medium text-foreground" : "text-muted-foreground"}>Monthly</span>
        <button
          type="button"
          role="switch"
          aria-checked={annual}
          onClick={() => setAnnual((v) => !v)}
          className="relative h-6 w-11 rounded-full bg-secondary transition-colors data-[on=true]:bg-primary"
          data-on={annual}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${annual ? "translate-x-5" : "translate-x-0.5"}`}
          />
        </button>
        <span className={annual ? "font-medium text-foreground" : "text-muted-foreground"}>
          Annual <span className="text-xs text-primary">(up to 20% off)</span>
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {PLAN_ORDER.map((planId) => {
          const plan = PLAN_CONFIGS[planId];
          const price = annual && plan.annualPriceUsd !== null ? plan.annualPriceUsd / 12 : plan.monthlyPriceUsd;
          const upToVideos = Math.floor(plan.monthlyCredits / STANDARD_VIDEO_BASE_CREDITS);
          const restrictions = restrictionsFor(plan);

          return (
            <Card key={planId} className={planId === "creator" ? "border-primary/60" : undefined}>
              <CardHeader>
                {planId === "creator" && <Badge className="mb-2 w-fit">Most popular</Badge>}
                <CardTitle>{plan.displayName}</CardTitle>
                <div className="mt-2">
                  <span className="text-3xl font-bold">${price.toFixed(price % 1 === 0 ? 0 : 2)}</span>
                  <span className="text-sm text-muted-foreground">/mo</span>
                </div>
                {annual && plan.annualPriceUsd !== null && (
                  <p className="text-xs text-muted-foreground">${plan.annualPriceUsd}/year, billed annually</p>
                )}
                <CardDescription>
                  {plan.oneTimeCreditsOnly
                    ? `${plan.monthlyCredits} one-time credits after email verification`
                    : `${plan.monthlyCredits} credits/month`}
                  {" — up to "}
                  {upToVideos} standard video{upToVideos === 1 ? "" : "s"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <ul className="space-y-1.5">
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {plan.maxResolution === "4k" ? "Up to 4K export" : plan.maxResolution === "1080p" ? "1080p export" : "720p export"}
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {plan.brandPresetLimit > 0
                      ? `${plan.brandPresetLimit} brand preset${plan.brandPresetLimit === 1 ? "" : "s"}`
                      : "No brand presets"}
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {plan.seatsIncluded} seat{plan.seatsIncluded === 1 ? "" : "s"} included
                    {plan.seatsIncluded > 1 && " (+$8/mo per additional seat)"}
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {plan.retentionDays ? `${plan.retentionDays}-day media retention` : "Standard media retention"}
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {plan.queue === "standard" ? "Standard render queue" : `${plan.queue[0].toUpperCase()}${plan.queue.slice(1)} render queue`}
                  </li>
                  {restrictions.map((r) => (
                    <li key={r} className="flex items-start gap-2 text-muted-foreground">
                      <X className="mt-0.5 h-4 w-4 shrink-0" />
                      {r}
                    </li>
                  ))}
                </ul>
                <Button disabled className="w-full" variant={planId === "creator" ? "default" : "outline"}>
                  Preview only
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
        Standard 30–45 second videos use {STANDARD_VIDEO_BASE_CREDITS} credits. Long uploads, voice cloning, 4K,
        and additional outputs use more credits. Clipforge shows the exact cost before every generation.
      </p>

      <div className="mx-auto mt-4 max-w-2xl space-y-1 text-center text-xs text-muted-foreground">
        <p>
          Credits refresh with your billing cycle. Annual plans release credits monthly, not all at once. Need
          more credits than your plan includes? <Link href="#" className="underline">Credit packs</Link> are
          available (100 for $9, 500 for $39, 1,500 for $99; 5,000 for $279 on approved Business/Enterprise
          accounts). Purchased credit packs do not bypass plan feature restrictions.
        </p>
        <p>Subscriptions renew automatically each billing period until canceled. Cancel anytime — you keep access through the end of the current period.</p>
        <p>Prices shown are in USD and do not include tax, which may apply based on your location. Final tax treatment is confirmed at checkout.</p>
      </div>

      <div className="mx-auto mt-16 max-w-3xl">
        <h2 className="text-center text-xl font-semibold">Enterprise</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">
          Custom credit volume on top of everything in Business.{" "}
          <Link href="/contact" className="underline">Contact us</Link> to discuss your team's needs.
        </p>
      </div>

      {competitors.length > 0 && (
        <div className="mx-auto mt-16 max-w-3xl">
          <h2 className="text-center text-lg font-semibold">Dated pricing reference</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-xs text-muted-foreground">
            Competitor credit systems aren't directly comparable to ours (some charge by uploaded minute, others
            by finished clip) — these are their own listed monthly prices only, not a claim that Clipforge is
            cheaper or gives more videos.
          </p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary/40">
                <tr>
                  <th className="px-4 py-2 font-medium">Competitor</th>
                  <th className="px-4 py-2 font-medium">Plan</th>
                  <th className="px-4 py-2 font-medium">Price</th>
                  <th className="px-4 py-2 font-medium">Verified</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((c) => (
                  <tr key={`${c.competitor}-${c.planName}`} className="border-t border-border/60">
                    <td className="px-4 py-2">{COMPETITOR_DISPLAY_NAMES[c.competitor] ?? c.competitor}</td>
                    <td className="px-4 py-2">{c.planName}</td>
                    <td className="px-4 py-2">
                      ${c.priceUsd}/mo{c.billingPeriod === "annual" ? " (annual)" : ""}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(c.verifiedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
