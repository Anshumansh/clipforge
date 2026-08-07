"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Share2 } from "lucide-react";

interface ConnectedAccount {
  id: string;
  platform: string;
  handle: string | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube Shorts",
  tiktok: "TikTok",
  instagram: "Instagram Reels",
};

export function PublishButton({ videoUrl, projectId, clipId }: { videoUrl: string; projectId?: string; clipId?: string }) {
  const [accounts, setAccounts] = useState<ConnectedAccount[] | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState<"idle" | "posting" | "posted" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || accounts) return;
    fetch("/api/social/accounts")
      .then((r) => r.json())
      .then((data) => setAccounts(data.accounts ?? []));
  }, [open, accounts]);

  async function publish() {
    if (!selectedId) return;
    setStatus("posting");
    setError(null);

    const res = await fetch("/api/social/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ socialAccountId: selectedId, videoUrl, caption, projectId, clipId }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus("failed");
      setError(data.error ?? "Publish failed");
      return;
    }
    setStatus("posted");
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Share2 className="h-3.5 w-3.5" /> Publish
      </Button>
    );
  }

  if (accounts === null) {
    return <p className="text-xs text-muted-foreground">Loading connected accounts…</p>;
  }

  if (accounts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No connected accounts. <Link href="/dashboard/settings" className="text-primary hover:underline">Connect one</Link>.
      </p>
    );
  }

  if (status === "posted") {
    return <p className="text-xs text-emerald-500">Posted!</p>;
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3">
      <div className="flex flex-wrap gap-1.5">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSelectedId(a.id)}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              selectedId === a.id ? "border-primary bg-primary/10" : "border-border"
            }`}
          >
            {PLATFORM_LABELS[a.platform] ?? a.platform}
          </button>
        ))}
      </div>
      <Textarea
        placeholder="Caption…"
        rows={2}
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        className="text-xs"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={!selectedId || status === "posting"} onClick={publish}>
          {status === "posting" ? "Publishing…" : "Publish now"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
