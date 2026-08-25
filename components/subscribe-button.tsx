"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SubscribeButton({
  plan,
  children,
  variant,
}: {
  plan: "hobby" | "creator" | "business";
  children: React.ReactNode;
  variant?: "default" | "outline";
}) {
  const { status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (status === "loading") return;
    if (status !== "authenticated") {
      const next = `/pricing?plan=${plan}#plan-${plan}`;
      router.push(`/register?next=${encodeURIComponent(next)}`);
      return;
    }

    setLoading(true);
    setError(null);

    let res: Response;
    try {
      res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
    } catch {
      setError("Could not reach checkout. Check your connection and try again.");
      setLoading(false);
      return;
    }
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.url) {
      setError(data.error ?? "Could not start checkout");
      setLoading(false);
      return;
    }

    window.location.href = data.url;
  }

  return (
    <div className="w-full">
      <Button onClick={onClick} disabled={loading || status === "loading"} className="w-full" variant={variant}>
        {loading ? "Redirecting to checkout…" : status === "loading" ? "Checking account…" : children}
      </Button>
      {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}
    </div>
  );
}
