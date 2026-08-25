"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Download, FileCode } from "lucide-react";
import { PublishButton } from "@/components/publish-button";
import { ThumbnailGenerator } from "@/components/thumbnail-generator";

interface Clip {
  id: string;
  title: string;
  startSec: number;
  endSec: number;
  status: string;
  videoUrl: string | null;
  score: number;
}

interface ProjectData {
  id: string;
  type: string;
  title: string;
  status: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  hasTimeline: boolean;
  errorMessage: string | null;
  clips: Clip[];
  job: { status: string; progress: number; log: string | null } | null;
}

const statusVariant = {
  draft: "outline",
  queued: "secondary",
  processing: "warning",
  ready: "success",
  failed: "destructive",
} as const;

function scoreTone(score: number) {
  if (score >= 75) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
  if (score >= 50) return "border-amber-500/40 bg-amber-500/10 text-amber-500";
  return "border-muted-foreground/30 bg-muted text-muted-foreground";
}

function VideoCard({
  title,
  url,
  score,
  projectId,
  clipId,
}: {
  title: string;
  url: string;
  score?: number;
  projectId?: string;
  clipId?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="relative">
          <video src={url} controls className="mx-auto h-auto max-h-[480px] w-auto max-w-full rounded-lg bg-black" />
          {typeof score === "number" && (
            <span
              className={`absolute right-2 top-2 rounded-full border px-2 py-0.5 text-xs font-semibold ${scoreTone(score)}`}
              title="Predicted hook/share strength"
            >
              {score} Hook Score
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="line-clamp-1 text-sm font-medium">{title}</p>
          <a href={url} download className="shrink-0 text-primary hover:opacity-80" title="Download">
            <Download className="h-4 w-4" />
          </a>
        </div>
        <div className="mt-3">
          <PublishButton videoUrl={url} projectId={projectId} clipId={clipId} />
        </div>
      </CardContent>
    </Card>
  );
}

// Base poll interval: 3-5s per the perf brief, picked once per component
// mount (not per tick) so a given viewer's requests don't all land in the
// same instant as everyone else's -- with 100 concurrent users on an active
// job, unjittered fixed-interval polling would otherwise synchronize into
// periodic bursts against the DB rather than spreading load evenly.
const POLL_BASE_MS = 4000;
const POLL_JITTER_MS = 1000;
// After this long spent continuously queued/processing, back off toward the
// slower end of the brief's 10-15s range -- a job that's been sitting for
// minutes doesn't need the same responsiveness as one that just started.
const SLOWDOWN_AFTER_MS = 60_000;
const SLOW_POLL_MS = 12_000;

function nextPollDelay(pollingSinceMs: number): number {
  const elapsed = Date.now() - pollingSinceMs;
  const base = elapsed > SLOWDOWN_AFTER_MS ? SLOW_POLL_MS : POLL_BASE_MS;
  return base + Math.random() * POLL_JITTER_MS;
}

export function ProjectStatus({ initial }: { initial: ProjectData }) {
  const [data, setData] = useState<ProjectData>(initial);

  useEffect(() => {
    if (data.status !== "queued" && data.status !== "processing") return;

    const pollingSince = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    async function tick() {
      // Skip the network round trip entirely while the tab isn't visible --
      // there's no UI to update, and it's needless DB load for a viewer
      // who's switched away. Polling resumes on its own next scheduled tick
      // after the tab becomes visible again (checked fresh each time, so no
      // separate visibilitychange listener/backlog of missed ticks to
      // reconcile).
      if (!document.hidden) {
        const res = await fetch(`/api/projects/${data.id}`).catch(() => null);
        if (!cancelled && res?.ok) setData(await res.json());
      }
      if (!cancelled) timer = setTimeout(tick, nextPollDelay(pollingSince));
    }

    timer = setTimeout(tick, nextPollDelay(pollingSince));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [data.status, data.id]);

  const isRendering = data.status === "queued" || data.status === "processing";
  const readyClips = data.clips.filter((c) => c.status === "ready" && c.videoUrl);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{data.title}</h1>
          <p className="text-sm text-muted-foreground capitalize">{data.type} project</p>
        </div>
        <Badge variant={statusVariant[data.status as keyof typeof statusVariant] ?? "outline"}>{data.status}</Badge>
      </div>

      {isRendering && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {data.job?.log ?? "Queued for rendering…"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={data.job?.progress ?? 0} />
            <p className="mt-2 text-xs text-muted-foreground">{data.job?.progress ?? 0}%</p>
          </CardContent>
        </Card>
      )}

      {data.status === "failed" && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-destructive">Render failed</p>
              <p className="text-sm text-muted-foreground">{data.errorMessage ?? "Unknown error"}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {data.status === "ready" && data.type !== "repurpose" && data.videoUrl && (
        <div className="mx-auto max-w-md space-y-4">
          <VideoCard title={data.title} url={data.videoUrl} projectId={data.id} />
          <ThumbnailGenerator projectId={data.id} initialUrl={data.thumbnailUrl} />
          {data.type === "script" && data.hasTimeline && (
            <Card>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium">Edit further in an NLE</p>
                  <p className="text-xs text-muted-foreground">Export the scene timeline for Premiere or DaVinci Resolve.</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <a
                    href={`/api/projects/${data.id}/export?format=edl`}
                    download
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
                  >
                    <FileCode className="h-3.5 w-3.5" /> EDL
                  </a>
                  <a
                    href={`/api/projects/${data.id}/export?format=xml`}
                    download
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
                  >
                    <FileCode className="h-3.5 w-3.5" /> XML
                  </a>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {data.type === "repurpose" && readyClips.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {readyClips.map((clip) => (
            <VideoCard
              key={clip.id}
              title={clip.title}
              url={clip.videoUrl!}
              score={clip.score}
              projectId={data.id}
              clipId={clip.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
