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
  plan: "creator" | "business";
  children: React.ReactNode;
  variant?: "default" | "outline";
}) {
  const { status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (status !== "authenticated") {
      router.push("/register");
      return;
    }

    setLoading(true);
    setError(null);

    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
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
      <Button onClick={onClick} disabled={loading} className="w-full" variant={variant}>
        {loading ? "Redirecting to checkout…" : children}
      </Button>
      {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}
    </div>
  );
}
