"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Download } from "lucide-react";

interface Clip {
  id: string;
  title: string;
  startSec: number;
  endSec: number;
  status: string;
  videoUrl: string | null;
}

interface ProjectData {
  id: string;
  type: string;
  title: string;
  status: string;
  videoUrl: string | null;
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

function VideoCard({ title, url }: { title: string; url: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <video src={url} controls className="mx-auto aspect-[9/16] w-full max-w-[280px] rounded-lg bg-black" />
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="line-clamp-1 text-sm font-medium">{title}</p>
          <a href={url} download className="shrink-0 text-primary hover:opacity-80" title="Download">
            <Download className="h-4 w-4" />
          </a>
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
        <div className="flex justify-center">
          <VideoCard title={data.title} url={data.videoUrl} />
        </div>
      )}

      {data.type === "repurpose" && readyClips.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {readyClips.map((clip) => (
            <VideoCard key={clip.id} title={clip.title} url={clip.videoUrl!} />
          ))}
        </div>
      )}
    </div>
  );
}
