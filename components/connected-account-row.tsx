"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
}: {
  platform: SocialPlatform;
  label: string;
  connected: ConnectedAccount | null;
  configured: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function disconnect() {
    setLoading(true);
    await fetch("/api/social/accounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform }),
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {connected ? connected.handle ?? "Connected" : configured ? "Not connected" : "Not set up on this server yet"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {connected && <Badge variant="success">Active</Badge>}
        {connected ? (
          <Button variant="outline" size="sm" onClick={disconnect} disabled={loading}>
            {loading ? "Disconnecting…" : "Disconnect"}
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
