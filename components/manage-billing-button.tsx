"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ManageBillingButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setError(null);

    let res: Response;
    try {
      res = await fetch("/api/stripe/portal", { method: "POST" });
    } catch {
      setError("Could not reach billing. Check your connection and try again.");
      setLoading(false);
      return;
    }
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.url) {
      setError(data.error ?? "Could not open billing portal");
      setLoading(false);
      return;
    }

    window.location.href = data.url;
  }

  return (
    <div>
      <Button onClick={onClick} disabled={loading} variant="outline">
        {loading ? "Opening…" : "Manage billing"}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
