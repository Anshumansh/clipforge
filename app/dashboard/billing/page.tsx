import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ManageBillingButton } from "@/components/manage-billing-button";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { PLANS } from "@/lib/plans";
import { formatDate } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";

export const metadata: Metadata = { title: "Billing" };

const planNames: Record<string, string> = { free: "Free", hobby: "Hobby", creator: "Creator", business: "Business" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: { success?: string };
}) {
  const user = await requireUser();
  const currentPlan = PLANS.find((p) => p.id === user.plan);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-sm text-muted-foreground">Manage your plan and credits.</p>
      </div>

      {searchParams.success && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-500">
          <CheckCircle2 className="h-4 w-4" /> Subscription active — credits have been added to your account.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Current plan
            <Badge variant={user.plan === "free" ? "outline" : "success"}>{planNames[user.plan] ?? user.plan}</Badge>
          </CardTitle>
          <CardDescription>
            {user.credits} credits remaining
            {currentPlan ? ` · renews monthly with ${currentPlan.monthlyCredits} credits` : ""}
            {user.stripeCurrentPeriodEnd ? ` · next renewal ${formatDate(user.stripeCurrentPeriodEnd)}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {user.stripeCustomerId ? (
            <ManageBillingButton />
          ) : (
            <Button asChild>
              <Link href="/pricing">Upgrade plan</Link>
            </Button>
          )}
          {user.plan !== "business" && (
            <Button asChild variant="outline">
              <Link href="/pricing">View plans</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Danger zone</CardTitle>
          <CardDescription>Permanently delete your account and all associated data.</CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccountButton />
        </CardContent>
      </Card>
    </div>
  );
}
