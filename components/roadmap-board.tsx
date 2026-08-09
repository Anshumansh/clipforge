"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  status: string;
  voteCount: number;
  hasVoted: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
};

const STATUS_VARIANT: Record<string, "outline" | "warning" | "success"> = {
  open: "outline",
  planned: "outline",
  in_progress: "warning",
  shipped: "success",
};

const ALL_STATUSES = ["open", "planned", "in_progress", "shipped"];

export function RoadmapBoard({
  initialItems,
  loggedIn,
  isAdmin,
}: {
  initialItems: RoadmapItem[];
  loggedIn: boolean;
  isAdmin: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleVote(id: string) {
    if (!loggedIn) return;
    // Optimistic update -- a vote toggle is low-stakes enough not to wait on the round trip.
    setItems((prev) =>
      prev
        .map((item) =>
          item.id === id
            ? { ...item, hasVoted: !item.hasVoted, voteCount: item.voteCount + (item.hasVoted ? -1 : 1) }
            : item
        )
        .sort((a, b) => b.voteCount - a.voteCount)
    );
    await fetch(`/api/roadmap/${id}/vote`, { method: "POST" }).catch(() => {});
  }

  async function updateStatus(id: string, status: string) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
    await fetch(`/api/roadmap/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => {});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/roadmap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }

    setItems((prev) =>
      [{ id: data.id, title, description, status: "open", voteCount: 1, hasVoted: true }, ...prev].sort(
        (a, b) => b.voteCount - a.voteCount
      )
    );
    setTitle("");
    setDescription("");
  }

  return (
    <div className="mt-8">
      {loggedIn ? (
        <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card/60 p-4">
          <p className="text-sm font-medium">Suggest a feature</p>
          <input
            required
            minLength={5}
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short, specific title"
            className="mt-2 w-full rounded-lg border border-border bg-background/60 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <textarea
            maxLength={1000}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What would this let you do? (optional)"
            className="mt-2 w-full resize-none rounded-lg border border-border bg-background/60 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" className="mt-2" disabled={submitting || title.trim().length < 5}>
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </form>
      ) : (
        <div className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            Log in
          </Link>{" "}
          to suggest a feature or vote.
        </div>
      )}

      <div className="mt-6 space-y-3">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">No requests yet — be the first to suggest one.</p>
        )}
        {items.map((item) => (
          <div key={item.id} className="flex gap-4 rounded-xl border border-border bg-card/40 p-4">
            <button
              type="button"
              onClick={() => toggleVote(item.id)}
              disabled={!loggedIn}
              aria-pressed={item.hasVoted}
              className={cn(
                "flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-lg border text-sm font-semibold transition-colors",
                item.hasVoted
                  ? "border-primary/60 bg-primary/15 text-foreground"
                  : "border-border bg-background/40 text-muted-foreground",
                loggedIn && "hover:border-primary/40"
              )}
            >
              <ChevronUp className="h-4 w-4" />
              {item.voteCount}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">{item.title}</h3>
                {isAdmin ? (
                  <select
                    value={item.status}
                    onChange={(e) => updateStatus(item.id, e.target.value)}
                    className="rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-xs"
                  >
                    {ALL_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge variant={STATUS_VARIANT[item.status] ?? "outline"}>
                    {STATUS_LABEL[item.status] ?? item.status}
                  </Badge>
                )}
              </div>
              {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
