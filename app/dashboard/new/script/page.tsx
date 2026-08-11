"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AspectRatioPicker } from "@/components/aspect-ratio-picker";
import { Sparkles, Wand2 } from "lucide-react";
import type { AspectRatio } from "@/lib/aspect-ratio";
import { LANGUAGES } from "@/lib/languages";
import { GenerationOperation } from "@/lib/generation-client";

export default function NewScriptVideoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [topic, setTopic] = useState(() => searchParams.get("topic") ?? "");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [language, setLanguage] = useState("en");
  const [voiceSample, setVoiceSample] = useState<File | null>(null);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hooks, setHooks] = useState<string[] | null>(null);
  const [hooksLoading, setHooksLoading] = useState(false);
  // Owns this wizard's operation id across its full retry lifecycle -- see
  // lib/generation-client.ts for exactly when it's retained vs cleared. A
  // stable instance for the component's lifetime (never re-created, never
  // triggers a re-render).
  const [operation] = useState(() => new GenerationOperation());

  async function getHooks() {
    setHooksLoading(true);
    setHooks(null);
    const res = await fetch("/api/hooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
    });
    const data = await res.json().catch(() => ({}));
    setHooksLoading(false);
    if (res.ok) setHooks(data.hooks ?? []);
  }

  function useHook(hook: string) {
    setTopic((current) => `Open with this exact hook: "${hook}"\n\n${current}`);
    setHooks(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return; // re-entrancy guard against a double-click firing two submits

    const operationId = operation.begin();

    setLoading(true);
    setError(null);

    const form = new FormData();
    form.set("topic", topic);
    form.set("aspectRatio", aspectRatio);
    form.set("language", language);
    if (voiceSample) {
      form.set("voiceSample", voiceSample);
      form.set("voiceConsent", String(voiceConsent));
    }

    let res: Response;
    try {
      res = await fetch("/api/projects/script", {
        method: "POST",
        headers: { "Idempotency-Key": operationId },
        body: form,
      });
    } catch {
      // Network/transport failure -- we can't tell whether the server
      // already reserved credits before the connection broke. Retain the
      // operation id so a retry reuses the same Idempotency-Key instead of
      // risking a second charge under a fresh one.
      operation.onNetworkError();
      setLoading(false);
      setError("Network error. Check your connection and try again.");
      return;
    }

    const data = await res.json().catch(() => ({}));
    setLoading(false);
    operation.onResponse(res.status, data.code);

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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-primary"
                disabled={topic.trim().length < 3 || hooksLoading}
                onClick={getHooks}
              >
                <Sparkles className="h-3.5 w-3.5" /> {hooksLoading ? "Thinking of hooks…" : "Get 3 hook ideas"}
              </Button>
              {hooks && hooks.length > 0 && (
                <div className="space-y-1.5 rounded-lg border border-border bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground">Pick one to open your video with:</p>
                  {hooks.map((hook, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => useHook(hook)}
                      className="block w-full rounded-md border border-transparent px-2 py-1.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/10"
                    >
                      "{hook}"
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Format</Label>
              <AspectRatioPicker value={aspectRatio} onChange={setAspectRatio} />
              <p className="text-xs text-muted-foreground">1:1 and 16:9 are a Business-plan feature.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="language">Script + voiceover language</Label>
              <select
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="voiceSample">Clone your voice (optional)</Label>
              <Input
                id="voiceSample"
                type="file"
                accept="audio/*"
                onChange={(e) => {
                  setVoiceSample(e.target.files?.[0] ?? null);
                  setVoiceConsent(false);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Upload a clean 10-30s voice sample and we'll narrate in that voice instead of a stock one. A
                Business-plan feature.
              </p>
              {voiceSample && (
                <label className="flex items-start gap-2 rounded-lg border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    required
                    checked={voiceConsent}
                    onChange={(e) => setVoiceConsent(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                  />
                  <span>
                    I confirm this is my own voice, or I have the explicit, informed consent of the person whose
                    voice this is, to clone it through Clipforge. Cloning someone's voice without their consent
                    violates our{" "}
                    <a href="/terms#4-1-voice-cloning" target="_blank" className="text-primary hover:underline">
                      Terms of Service
                    </a>
                    .
                  </span>
                </label>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading || (!!voiceSample && !voiceConsent)} className="w-full">
              {loading ? "Starting render…" : "Generate video"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
