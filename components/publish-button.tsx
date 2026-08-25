"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Share2 } from "lucide-react";
import { useCurrentPlan } from "@/components/plan-provider";
import { canUseSocialPublishing } from "@/lib/plans";

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
  const currentPlan = useCurrentPlan();
  const canPublish = canUseSocialPublishing(currentPlan);
  const [accounts, setAccounts] = useState<ConnectedAccount[] | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [caption, setCaption] = useState("");
  const [scheduleFor, setScheduleFor] = useState(""); // datetime-local value, empty = post now
  const [status, setStatus] = useState<"idle" | "posting" | "posted" | "scheduled" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canPublish || !open || accounts) return;
    fetch("/api/social/accounts")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error ?? "Could not load connected accounts");
        setAccounts(data.accounts ?? []);
      })
      .catch(() => {
        setAccounts([]);
        setError("Could not load connected accounts. Please try again.");
      });
  }, [canPublish, open, accounts]);

  async function publish() {
    if (!selectedId) return;
    const scheduling = scheduleFor.length > 0;
    setStatus("posting");
    setError(null);

    let res: Response;
    try {
      res = await fetch("/api/social/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          socialAccountId: selectedId,
          videoUrl,
          caption,
          projectId,
          clipId,
          ...(scheduling ? { scheduledAt: new Date(scheduleFor).toISOString() } : {}),
        }),
      });
    } catch {
      setStatus("failed");
      setError("Could not reach the server. Check your connection and try again.");
      return;
    }
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus("failed");
      setError(data.error ?? "Publish failed");
      return;
    }
    setStatus(scheduling ? "scheduled" : "posted");
  }

  if (!canPublish) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5" asChild>
        <Link href="/pricing"><Share2 className="h-3.5 w-3.5" /> Publish with Creator</Link>
      </Button>
    );
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
      <div className="space-y-1">
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          No connected accounts. <Link href="/dashboard/settings" className="text-primary underline underline-offset-2 hover:no-underline">Connect one</Link>.
        </p>
      </div>
    );
  }

  if (status === "posted") {
    return <p className="text-xs text-emerald-500">Posted!</p>;
  }

  if (status === "scheduled") {
    return (
      <p className="text-xs text-emerald-500">
        Scheduled for {new Date(scheduleFor).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.{" "}
        <Link href="/dashboard/schedule" className="underline">
          View schedule
        </Link>
      </p>
    );
  }

  const minDatetime = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16);

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
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
      <div className="flex items-center gap-2">
        <input
          type="datetime-local"
          value={scheduleFor}
          min={minDatetime}
          onChange={(e) => setScheduleFor(e.target.value)}
          className="rounded-md border border-border bg-background/60 px-2 py-1 text-xs"
        />
        <span className="text-xs text-muted-foreground">{scheduleFor ? "" : "Leave blank to post now"}</span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={!selectedId || status === "posting"} onClick={publish}>
          {status === "posting" ? (scheduleFor ? "Scheduling…" : "Publishing…") : scheduleFor ? "Schedule" : "Publish now"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
