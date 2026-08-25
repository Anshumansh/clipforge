"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, Loader2, Play, FileText, Wand2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroShowcase } from "@/components/hero-showcase";
import { cn } from "@/lib/utils";

interface Clip {
  src: string;
  label: string;
}

/** A small real-output preview tile -- same production render URLs as the
 * "Real output, not mockups" section further down the page, just shown
 * immediately in the hero. The <video>'s `src` isn't set until the first
 * hover/tap/focus (not merely `preload="metadata"` on mount) -- three tiles
 * eagerly fetching metadata for a 10-30MB file each, on every homepage load,
 * regardless of whether a visitor ever interacts with them, is exactly the
 * "load real video before the user acts" pattern the perf brief calls out.
 * Once loaded, `preload="metadata"` still applies so the first hover/tap
 * only needs to start playback, not begin a fresh negotiation. */
function ClipTile({ clip }: { clip: Clip }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [interacted, setInteracted] = useState(false);
  const [playing, setPlaying] = useState(false);

  function loadThenPlay() {
    setInteracted(true);
    const video = videoRef.current;
    if (!video) return;

    // Keep the element mounted without a src so the first real interaction
    // can attach the URL and call play() in the same user-activation event.
    // The previous conditional mount deferred play() to requestAnimationFrame;
    // Firefox/WebKit can treat that as outside the click activation window.
    if (!video.currentSrc) {
      video.src = clip.src;
      video.load();
    }
    void video.play().catch(() => {
      // A browser policy may still reject hover/focus autoplay. The element
      // stays loaded so a subsequent explicit click can start it.
    });
  }

  return (
    <button
      type="button"
      className="group relative aspect-[9/16] w-full overflow-hidden rounded-lg border border-border bg-black"
      onMouseEnter={loadThenPlay}
      onFocus={loadThenPlay}
      onMouseLeave={() => {
        const v = videoRef.current;
        if (!v) return;
        v.pause();
        v.currentTime = 0;
      }}
      onClick={(e) => {
        const video = videoRef.current;
        // Focus fires before click. Do not let that same click immediately
        // pause the playback focus just started; only treat a later click as
        // a pause after the clip has genuinely advanced.
        if (!video || video.paused || video.currentTime < 0.05) {
          loadThenPlay();
        } else {
          video.pause();
        }
        e.currentTarget.blur();
      }}
      aria-label={`Preview: ${clip.label}`}
      aria-pressed={playing}
    >
      <video
        ref={videoRef}
        muted
        loop
        playsInline
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className={cn("h-full w-full object-cover transition-opacity", interacted ? "opacity-100" : "opacity-0")}
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
        <Play className="h-5 w-5 fill-white text-white" />
      </div>
      <p className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-3 text-[10px] font-medium text-white">
        {clip.label}
      </p>
    </button>
  );
}

type DemoState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "processing"; progress: number; log: string | null }
  | { phase: "ready"; videoUrl: string }
  | { phase: "error"; message: string };

const POLL_INTERVAL_MS = 3000;

// Condensed version of the script-to-video engine's real steps -- see
// /how-it-works for the full mechanics.
const tutorialSteps = [
  { icon: FileText, text: "Paste a topic, script, or article" },
  { icon: Wand2, text: "Clipforge writes, voices, captions, and cuts b-roll" },
  { icon: Send, text: "Download it or publish straight to TikTok, Reels, Shorts" },
];

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

      <div className="mt-5">
        <p className="text-center text-xs text-muted-foreground lg:text-left">Real output — tap or hover to preview:</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {clips.map((clip) => (
            <ClipTile key={clip.src} clip={clip} />
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-border bg-card/40 p-4">
        <p className="text-xs font-medium text-muted-foreground">How it works</p>
        <ol className="mt-3 space-y-2.5">
          {tutorialSteps.map((step) => (
            <li key={step.text} className="flex items-center gap-2.5 text-xs">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15">
                <step.icon className="h-3 w-3 text-primary" />
              </span>
              <span className="text-muted-foreground">{step.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
