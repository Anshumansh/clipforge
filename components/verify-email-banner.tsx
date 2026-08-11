"use client";

import { useState } from "react";
import { MailWarning } from "lucide-react";
import { Button } from "@/components/ui/button";

export function VerifyEmailBanner() {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setState("sending");
    setError(null);
    const res = await fetch("/api/auth/resend-verification", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      setState("idle");
      return;
    }
    setState("sent");
  }

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <div className="flex items-center gap-2 text-amber-500">
        <MailWarning className="h-4 w-4 shrink-0" />
        <span>
          Verify your email to generate videos, clone your voice, create API keys, or invite teammates.
        </span>
      </div>
      {state === "sent" ? (
        <span className="text-xs text-muted-foreground">Sent — check your inbox.</span>
      ) : (
        <Button size="sm" variant="outline" onClick={resend} disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Resend verification email"}
        </Button>
      )}
      {error && <span className="w-full text-xs text-destructive">{error}</span>}
    </div>
  );
}
