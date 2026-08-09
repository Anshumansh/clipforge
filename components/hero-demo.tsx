"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroShowcase } from "@/components/hero-showcase";
import { cn } from "@/lib/utils";

interface Clip {
  src: string;
  label: string;
}

type DemoState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "processing"; progress: number; log: string | null }
  | { phase: "ready"; videoUrl: string }
  | { phase: "error"; message: string };

const POLL_INTERVAL_MS = 3000;

export function HeroDemo({ clips }: { clips: Clip[] }) {
  const [mode, setMode] = useState<"try" | "examples">("try");
  const [topic, setTopic] = useState("");
  const [demo, setDemo] = useState<DemoState>({ phase: "idle" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function pollStatus(projectId: string) {
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/demo/status/${projectId}`).catch(() => null);
      if (!res || !res.ok) return;
      const data = await res.json();

      if (data.status === "ready" && data.videoUrl) {
        if (pollRef.current) clearInterval(pollRef.current);
        setDemo({ phase: "ready", videoUrl: data.videoUrl });
      } else if (data.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        setDemo({ phase: "error", message: "Something went wrong generating that — please try again." });
      } else {
        setDemo({ phase: "processing", progress: data.progress ?? 0, log: data.log ?? null });
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDemo({ phase: "submitting" });

    const res = await fetch("/api/demo/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setDemo({ phase: "error", message: data.error ?? "Something went wrong — please try again." });
      return;
    }

    setDemo({ phase: "processing", progress: 5, log: "Queued…" });
    pollStatus(data.projectId);
  }

  return (
    <div className="mx-auto w-full max-w-[280px] lg:mx-0">
      <div className="mb-4 flex justify-center gap-2 lg:justify-start">
        <button
          type="button"
          onClick={() => setMode("try")}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
            mode === "try"
              ? "border-primary/60 bg-primary/15 text-foreground"
              : "border-border/60 bg-card/40 text-muted-foreground hover:text-foreground"
          )}
        >
          Try it free — no signup
        </button>
        <button
          type="button"
          onClick={() => setMode("examples")}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
            mode === "examples"
              ? "border-primary/60 bg-primary/15 text-foreground"
              : "border-border/60 bg-card/40 text-muted-foreground hover:text-foreground"
          )}
        >
          See examples
        </button>
      </div>

      {mode === "examples" && <HeroShowcase clips={clips} />}

      {mode === "try" && (
        <div className="glow-ring rounded-2xl">
          <div className="flex min-h-[340px] flex-col justify-between rounded-2xl border border-border bg-card/60 p-4">
            {(demo.phase === "idle" || demo.phase === "submitting" || demo.phase === "error") && (
              <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
                <label htmlFor="demo-topic" className="text-xs font-medium text-muted-foreground">
                  Paste a topic or short script idea
                </label>
                <textarea
                  id="demo-topic"
                  required
                  minLength={10}
                  maxLength={300}
                  rows={5}
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. 3 morning habits that actually make you more productive"
                  className="mt-2 flex-1 resize-none rounded-lg border border-border bg-background/60 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {demo.phase === "error" && (
                  <p className="mt-2 text-xs text-destructive">{demo.message}</p>
                )}
                <Button type="submit" disabled={demo.phase === "submitting" || topic.trim().length < 10} className="mt-3 gap-1.5">
                  <Sparkles className="h-4 w-4" />
                  {demo.phase === "submitting" ? "Starting…" : "Generate my clip — free"}
                </Button>
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  No account needed · 3 free demos/day · watermarked
                </p>
              </form>
            )}

            {demo.phase === "processing" && (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="mt-3 text-sm font-medium">{demo.log ?? "Generating your video…"}</p>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${Math.max(demo.progress, 5)}%` }}
                  />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Usually takes a minute or two — worth the wait.</p>
              </div>
            )}

            {demo.phase === "ready" && (
              <div className="flex flex-1 flex-col">
                <video
                  src={demo.videoUrl}
                  controls
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="aspect-[9/16] w-full rounded-lg bg-black"
                />
                <Button asChild className="mt-3">
                  <Link href="/register">Love it? Sign up free to make more</Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
