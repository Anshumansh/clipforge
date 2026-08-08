"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lightbulb, Sparkles, Wand2 } from "lucide-react";
import type { VideoIdea } from "@/lib/providers/ideas";

export default function IdeaRadarPage() {
  const router = useRouter();
  const [niche, setNiche] = useState("");
  const [ideas, setIdeas] = useState<VideoIdea[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);

    const res = await fetch("/api/ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: niche.trim() || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    setIdeas(data.ideas);
  }

  function useIdea(idea: VideoIdea) {
    const topic = idea.hook ? `${idea.title}\n\nOpen with this hook: "${idea.hook}"\n\n${idea.description}` : `${idea.title}\n\n${idea.description}`;
    router.push(`/dashboard/new/script?topic=${encodeURIComponent(topic)}`);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/20 to-primary/20">
          <Lightbulb className="h-5 w-5 text-amber-500" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Idea Radar</h1>
          <p className="text-sm text-muted-foreground">Stuck on what to post today? Get fresh, ready-to-use video ideas — free, no credits used.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What's your niche?</CardTitle>
          <CardDescription>Optional — leave blank for a broad mix of trending angles.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="niche" className="sr-only">Niche</Label>
              <Input
                id="niche"
                placeholder="e.g. personal finance, fitness, SaaS marketing…"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && generate()}
              />
            </div>
            <Button onClick={generate} disabled={loading} className="shrink-0 gap-1.5">
              <Sparkles className="h-4 w-4" /> {loading ? "Thinking…" : ideas ? "Generate more" : "Generate ideas"}
            </Button>
          </div>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {ideas && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {ideas.map((idea, i) => (
            <Card key={i} className="flex h-full flex-col">
              <CardHeader className="flex-1">
                <CardTitle className="text-base">{idea.title}</CardTitle>
                {idea.hook && <p className="text-sm italic text-primary">"{idea.hook}"</p>}
                <CardDescription>{idea.description}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => useIdea(idea)}>
                  <Wand2 className="h-3.5 w-3.5" /> Use this idea
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
