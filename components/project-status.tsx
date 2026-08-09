"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Download } from "lucide-react";
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

export function ProjectStatus({ initial }: { initial: ProjectData }) {
  const [data, setData] = useState<ProjectData>(initial);

  useEffect(() => {
    if (data.status !== "queued" && data.status !== "processing") return;

    const interval = setInterval(async () => {
      const res = await fetch(`/api/projects/${data.id}`);
      if (res.ok) setData(await res.json());
    }, 2000);

    return () => clearInterval(interval);
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
