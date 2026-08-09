"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Coins, Sparkles, ShieldCheck } from "lucide-react";

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  credits: number;
  isAdmin: boolean;
  compPlanExpiresAt: string | null;
  createdAt: string;
}

interface AdminActionLog {
  id: string;
  adminEmail: string;
  targetEmail: string;
  type: string;
  creditsGranted: number | null;
  planGranted: string | null;
  previousPlan: string | null;
  days: number | null;
  note: string;
  createdAt: string;
}

const PLAN_OPTIONS = ["free", "hobby", "creator", "business"];

export function AdminPanel() {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<AdminUser[]>([]);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [actions, setActions] = useState<AdminActionLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [creditAmount, setCreditAmount] = useState("100");
  const [creditNote, setCreditNote] = useState("");
  const [compPlan, setCompPlan] = useState("business");
  const [compDays, setCompDays] = useState("14");
  const [compNote, setCompNote] = useState("");

  function loadActions() {
    fetch("/api/admin/actions")
      .then((r) => r.json())
      .then((d) => setActions(d.actions ?? []));
  }

  useEffect(() => {
    loadActions();
  }, []);

  useEffect(() => {
    if (search.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/admin/users?search=${encodeURIComponent(search.trim())}`)
        .then((r) => r.json())
        .then((d) => setResults(d.users ?? []));
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  function selectUser(u: AdminUser) {
    setSelected(u);
    setResults([]);
    setSearch("");
    setError(null);
  }

  async function grantCredits() {
    if (!selected) return;
    const amount = Number(creditAmount);
    if (!Number.isInteger(amount) || amount < 1) {
      setError("Enter a whole number of credits");
      return;
    }
    if (!creditNote.trim()) {
      setError("A note is required (shows up in the audit log)");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/grant-credits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selected.id, amount, note: creditNote.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    setSelected({ ...selected, credits: data.credits });
    setCreditNote("");
    loadActions();
  }

  async function compPlanAction() {
    if (!selected) return;
    const days = Number(compDays);
    if (!Number.isInteger(days) || days < 1) {
      setError("Enter a whole number of days");
      return;
    }
    if (!compNote.trim()) {
      setError("A note is required (shows up in the audit log)");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/comp-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selected.id, plan: compPlan, days, note: compNote.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    setSelected({ ...selected, plan: data.plan, compPlanExpiresAt: data.expiresAt });
    setCompNote("");
    loadActions();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Find an account</CardTitle>
          <CardDescription>Search by email (2+ characters).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="user@example.com"
              className="w-full rounded-md border border-border bg-background/60 py-2 pl-9 pr-3 text-sm"
            />
          </div>
          {results.length > 0 && (
            <div className="mt-2 space-y-1 rounded-md border border-border p-1">
              {results.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => selectUser(u)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-secondary"
                >
                  <span>{u.email}</span>
                  <span className="text-xs capitalize text-muted-foreground">{u.plan} · {u.credits} cr</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card className="border-primary/40">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{selected.name ?? selected.email}</CardTitle>
              <div className="flex gap-1.5">
                {selected.isAdmin && (
                  <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/5">
                    <ShieldCheck className="h-3 w-3" /> Admin
                  </Badge>
                )}
                <Badge variant="secondary" className="capitalize">{selected.plan}</Badge>
              </div>
            </div>
            <CardDescription>
              {selected.email} · {selected.credits} credits · joined {new Date(selected.createdAt).toLocaleDateString()}
              {selected.compPlanExpiresAt && new Date(selected.compPlanExpiresAt) > new Date() && (
                <span className="ml-2 text-amber-500">
                  · trial active until {new Date(selected.compPlanExpiresAt).toLocaleDateString()}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-lg border border-border p-4">
              <p className="mb-3 flex items-center gap-1.5 text-sm font-medium"><Coins className="h-4 w-4 text-primary" /> Grant credits</p>
              <div className="grid grid-cols-[100px_1fr] gap-2">
                <input
                  type="number"
                  min={1}
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  className="rounded-md border border-border bg-background/60 px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  value={creditNote}
                  onChange={(e) => setCreditNote(e.target.value)}
                  placeholder="Reason (e.g. support goodwill credit)"
                  className="rounded-md border border-border bg-background/60 px-3 py-2 text-sm"
                />
              </div>
              <Button className="mt-2" size="sm" onClick={grantCredits} disabled={busy}>
                {busy ? "Granting…" : "Grant credits"}
              </Button>
            </div>

            <div className="rounded-lg border border-border p-4">
              <p className="mb-3 flex items-center gap-1.5 text-sm font-medium"><Sparkles className="h-4 w-4 text-primary" /> Comp a plan (free trial)</p>
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <select
                  value={compPlan}
                  onChange={(e) => setCompPlan(e.target.value)}
                  className="rounded-md border border-border bg-background/60 px-3 py-2 text-sm capitalize"
                >
                  {PLAN_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={compDays}
                  onChange={(e) => setCompDays(e.target.value)}
                  className="rounded-md border border-border bg-background/60 px-3 py-2 text-sm"
                  title="Days"
                />
              </div>
              <input
                type="text"
                value={compNote}
                onChange={(e) => setCompNote(e.target.value)}
                placeholder="Reason (e.g. 14-day agency trial)"
                className="mt-2 w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Reverts to their current plan automatically when it expires. If they have a real active subscription, a
                Stripe renewal during the trial will override this.
              </p>
              <Button className="mt-2" size="sm" onClick={compPlanAction} disabled={busy}>
                {busy ? "Applying…" : "Apply trial"}
              </Button>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent admin actions</CardTitle>
          <CardDescription>Audit log — every credit grant and plan comp, most recent first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {actions.length === 0 && <p className="text-sm text-muted-foreground">No admin actions yet.</p>}
          {actions.map((a) => (
            <div key={a.id} className="rounded-lg border border-border px-4 py-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span>
                  {a.type === "credit_grant" ? (
                    <>+{a.creditsGranted} credits to <strong>{a.targetEmail}</strong></>
                  ) : (
                    <>
                      <strong>{a.targetEmail}</strong> comped to <span className="capitalize">{a.planGranted}</span> for{" "}
                      {a.days}d (was {a.previousPlan})
                    </>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">by {a.adminEmail} — {a.note}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
