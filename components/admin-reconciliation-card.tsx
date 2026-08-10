"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, ScanSearch } from "lucide-react";

interface ReconciliationIssue {
  userId: string;
  email: string;
  issue: string;
  local: { plan: string; stripePriceId: string | null; stripeSubscriptionId: string | null };
  stripeStatus: string | null;
  stripePriceId: string | null;
  fetchError: string | null;
}

export function AdminReconciliationCard() {
  const [checked, setChecked] = useState<number | null>(null);
  const [issues, setIssues] = useState<ReconciliationIssue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runCheck() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/reconciliation");
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    setChecked(data.checked);
    setIssues(data.issues);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stripe reconciliation</CardTitle>
        <CardDescription>
          Compares every local subscriber's plan against what Stripe actually says, read-only. Doesn't change
          anything — flags drift for you to act on.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={runCheck} disabled={busy}>
          <ScanSearch className="h-3.5 w-3.5" /> {busy ? "Checking…" : "Run check"}
        </Button>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {issues !== null && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Checked {checked} subscriber{checked === 1 ? "" : "s"} with a Stripe subscription on file.
            </p>
            {issues.length === 0 ? (
              <p className="flex items-center gap-1.5 text-sm text-emerald-500">
                <CheckCircle2 className="h-4 w-4" /> No drift found — local state matches Stripe.
              </p>
            ) : (
              issues.map((i) => (
                <div key={i.userId} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                  <p className="flex items-center gap-1.5 font-medium text-amber-500">
                    <AlertTriangle className="h-3.5 w-3.5" /> {i.email}
                  </p>
                  <p className="mt-1 text-muted-foreground">{i.issue}</p>
                  {i.fetchError && <p className="mt-1 text-muted-foreground">Stripe error: {i.fetchError}</p>}
                </div>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
