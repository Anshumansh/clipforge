"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Flame, Loader2, Radar, Sparkles, TrendingUp, X } from "lucide-react";
import { DiscoverTabs } from "@/components/discover-tabs";

interface ResolvedChannel {
  id: string;
  title: string;
}

interface TrendCard {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  channelTitle: string;
  velocity: number | null;
  score: number | null;
  hasBaseline: boolean;
  isBreakout: boolean;
  pattern: { hookType: string; structure: string; emotionalDriver: string } | null;
}

export default function TrendRadarPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const [niche, setNiche] = useState("");
  const [channels, setChannels] = useState<ResolvedChannel[]>([]);
  const [channelInput, setChannelInput] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [feed, setFeed] = useState<TrendCard[] | null>(null);
  const [feedNiche, setFeedNiche] = useState<string | null>(null);
  const [makingId, setMakingId] = useState<string | null>(null);
  const [makeError, setMakeError] = useState<string | null>(null);

  async function loadSetup() {
    const res = await fetch("/api/trend/onboarding");
    const data = await res.json();
    if (data.niche) {
      setNiche(data.niche);
      setChannels(data.channels.map((c: { id: string; title: string | null }) => ({ id: c.id, title: c.title ?? c.id })));
      await loadFeed();
    } else {
      setEditing(true);
    }
    setLoading(false);
  }

  async function loadFeed() {
    const res = await fetch("/api/trend/feed");
    const data = await res.json();
    if (data.needsOnboarding) {
      setEditing(true);
      return;
    }
    setFeed(data.cards);
    setFeedNiche(data.niche);
  }

  useEffect(() => {
    loadSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addChannel() {
    if (!channelInput.trim() || channels.length >= 10) return;
    setResolving(true);
    setResolveError(null);

    const res = await fetch("/api/trend/resolve-channel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: channelInput.trim() }),
    });
    const data = await res.json();
    setResolving(false);

    if (!res.ok) {
      setResolveError(data.error ?? "Couldn't find that channel");
      return;
    }
    if (channels.some((c) => c.id === data.channel.id)) {
      setResolveError("Already added");
      return;
    }
    setChannels((prev) => [...prev, { id: data.channel.id, title: data.channel.title }]);
    setChannelInput("");
  }

  function removeChannel(id: string) {
    setChannels((prev) => prev.filter((c) => c.id !== id));
  }

  async function saveSetup() {
    if (!niche.trim()) return;
    setSaving(true);

    const res = await fetch("/api/trend/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: niche.trim(), channels }),
    });
    setSaving(false);

    if (res.ok) {
      setEditing(false);
      setFeed(null);
      await loadFeed();
    }
  }

  async function makeVersion(videoId: string) {
    setMakingId(videoId);
    setMakeError(null);

    const res = await fetch("/api/trend/make-version", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId }),
    });
    const data = await res.json().catch(() => ({}));
    setMakingId(null);

    if (!res.ok) {
      setMakeError(data.error ?? "Something went wrong");
      return;
    }

    const prefill = data.flagged
      ? `${data.topic}\n\n(Note: this draft may be close to its source inspiration — consider revising before rendering.)`
      : data.topic;
    router.push(`/dashboard/new/script?topic=${encodeURIComponent(prefill)}`);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <DiscoverTabs />
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-accent/20">
          <Radar className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Discover trends</h1>
          <p className="text-sm text-muted-foreground">
            Videos breaking out relative to their own channel's normal pace — turn the pattern into an original
            video, one tap.
          </p>
        </div>
      </div>

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Set up your radar</CardTitle>
            <CardDescription>Pick a niche and up to 10 channels to track.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="niche">Your niche</Label>
              <Input
                id="niche"
                placeholder="e.g. personal finance, fitness, SaaS marketing…"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="channel">Inspiration channels ({channels.length}/10)</Label>
              <div className="flex gap-2">
                <Input
                  id="channel"
                  placeholder="Paste a channel URL or @handle"
                  value={channelInput}
                  onChange={(e) => setChannelInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addChannel())}
                  disabled={channels.length >= 10}
                />
                <Button type="button" variant="outline" onClick={addChannel} disabled={resolving || channels.length >= 10}>
                  {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                </Button>
              </div>
              {resolveError && <p className="text-xs text-destructive">{resolveError}</p>}

              {channels.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {channels.map((c) => (
                    <span
                      key={c.id}
                      className="flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/40 py-1 pl-3 pr-1.5 text-xs"
                    >
                      {c.title}
                      <button
                        type="button"
                        onClick={() => removeChannel(c.id)}
                        className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <Button onClick={saveSetup} disabled={saving || !niche.trim()} className="w-full gap-1.5">
              <Sparkles className="h-4 w-4" /> {saving ? "Starting your first scan…" : "Save & start tracking"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Tracking <span className="text-foreground">{feedNiche}</span>
            </p>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Edit channels
            </Button>
          </div>

          {makeError && <p className="mb-4 text-sm text-destructive">{makeError}</p>}

          {feed === null ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : feed.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 border-dashed py-16 text-center">
              <TrendingUp className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-medium">Gathering data</p>
                <p className="text-sm text-muted-foreground">
                  We're now tracking your channels — the first videos should show up within a few hours as the next
                  scan runs, and breakout detection needs a few real scan cycles to build a baseline. Check back soon.
                </p>
              </div>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {feed.map((card) => (
                <Card key={card.videoId} className="flex flex-col overflow-hidden">
                  <div className="relative aspect-video bg-muted">
                    {card.thumbnailUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={card.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    )}
                    <div className="absolute right-2 top-2">
                      {card.isBreakout ? (
                        <Badge className="gap-1 border-transparent bg-gradient-to-r from-amber-500 to-orange-500 text-white">
                          <Flame className="h-3 w-3" /> {card.score!.toFixed(1)}x normal pace
                        </Badge>
                      ) : card.hasBaseline ? (
                        <Badge variant="secondary">Steady</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-background/80">
                          Gathering data
                        </Badge>
                      )}
                    </div>
                  </div>
                  <CardHeader className="flex-1">
                    <CardTitle className="line-clamp-2 text-sm">{card.title}</CardTitle>
                    <CardDescription>{card.channelTitle}</CardDescription>
                    {card.pattern && (
                      <p className="text-xs text-muted-foreground">
                        <span className="text-primary">{card.pattern.hookType}</span> · driven by{" "}
                        {card.pattern.emotionalDriver}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Button
                      size="sm"
                      className="w-full gap-1.5"
                      disabled={makingId === card.videoId}
                      onClick={() => makeVersion(card.videoId)}
                    >
                      {makingId === card.videoId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      Make My Version
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
