"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, CheckCircle2, XCircle, Loader2 } from "lucide-react";

type State = "verifying" | "done" | "error";

export default function VerifyEmailPage({ params }: { params: { token: string } }) {
  const [state, setState] = useState<State>("verifying");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: params.token }),
      });
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        setState("error");
        return;
      }
      setState("done");
    })();
    return () => {
      cancelled = true;
    };
  }, [params.token]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Link href="/" className="mb-2 flex items-center gap-2 font-display font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-[hsl(262_83%_66%)] to-[hsl(316_80%_62%)]">
              <Sparkles className="h-4 w-4 text-white" />
            </span>
            Clipforge
          </Link>
          <CardTitle>Verifying your email</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 text-center">
          {state === "verifying" && (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <CardDescription>One moment…</CardDescription>
            </>
          )}
          {state === "done" && (
            <>
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <CardDescription>Your email is verified. You're all set.</CardDescription>
              <Button asChild className="mt-2 w-full">
                <Link href="/dashboard">Go to dashboard</Link>
              </Button>
            </>
          )}
          {state === "error" && (
            <>
              <XCircle className="h-8 w-8 text-destructive" />
              <CardDescription>{error}</CardDescription>
              <p className="text-xs text-muted-foreground">
                Links expire after 24 hours. Log in and resend a fresh one from your dashboard.
              </p>
              <Button asChild variant="outline" className="mt-2 w-full">
                <Link href="/login">Log in</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
