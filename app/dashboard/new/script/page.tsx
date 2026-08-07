"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AspectRatioPicker } from "@/components/aspect-ratio-picker";
import { Wand2 } from "lucide-react";
import type { AspectRatio } from "@/lib/aspect-ratio";

export default function NewScriptVideoPage() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [voiceSample, setVoiceSample] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData();
    form.set("topic", topic);
    form.set("aspectRatio", aspectRatio);
    if (voiceSample) form.set("voiceSample", voiceSample);

    const res = await fetch("/api/projects/script", { method: "POST", body: form });

    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }

    router.push(`/dashboard/projects/${data.projectId}`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
          <Wand2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Script to video</h1>
          <p className="text-sm text-muted-foreground">Paste a topic, script, or blog post — we'll do the rest.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your content</CardTitle>
          <CardDescription>10 credits per video</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="topic">Topic, script, or article text</Label>
              <Textarea
                id="topic"
                required
                minLength={3}
                rows={8}
                placeholder="e.g. Why most people fail at building a morning routine, and the one habit that actually sticks…"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Format</Label>
              <AspectRatioPicker value={aspectRatio} onChange={setAspectRatio} />
              <p className="text-xs text-muted-foreground">1:1 and 16:9 are a Business-plan feature.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="voiceSample">Clone your voice (optional)</Label>
              <Input
                id="voiceSample"
                type="file"
                accept="audio/*"
                onChange={(e) => setVoiceSample(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Upload a clean 10-30s voice sample and we'll narrate in that voice instead of a stock one. A
                Business-plan feature.
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Starting render…" : "Generate video"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
