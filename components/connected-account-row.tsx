"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import type { SocialPlatform } from "@/lib/social/platforms";

interface ConnectedAccount {
  id: string;
  platform: string;
  handle: string | null;
}

export function ConnectedAccountRow({
  platform,
  label,
  connected,
  configured,
  entitled,
}: {
  platform: SocialPlatform;
  label: string;
  connected: ConnectedAccount | null;
  configured: boolean;
  entitled: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    if (!window.confirm(`Disconnect ${label}? Scheduled posts for this account may fail.`)) return;
    setLoading(true);
    setError(null);
    const response = await fetch("/api/social/accounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform }),
    }).catch(() => null);
    setLoading(false);
    if (!response?.ok) {
      setError("Could not disconnect. Please try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {connected
            ? connected.handle ?? "Connected"
            : !entitled
              ? "Available on Creator and Business"
              : configured
                ? "Not connected"
                : "Not set up on this server yet"}
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex items-center gap-2">
        {connected && <Badge variant="success">Active</Badge>}
        {connected ? (
          <Button variant="outline" size="sm" onClick={disconnect} disabled={loading}>
            {loading ? "Disconnecting…" : "Disconnect"}
          </Button>
        ) : !entitled ? (
          <Button size="sm" variant="outline" asChild>
            <Link href="/pricing">View plans</Link>
          </Button>
        ) : (
          <Button size="sm" disabled={!configured} asChild={configured}>
            {configured ? <a href={`/api/social/connect/${platform}`}>Connect</a> : <span>Connect</span>}
          </Button>
        )}
      </div>
    </div>
  );
}
