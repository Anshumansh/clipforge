"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Scissors, UploadCloud } from "lucide-react";

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => reject(new Error("Could not read video metadata"));
    video.src = URL.createObjectURL(file);
  });
}

export default function NewRepurposePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Please choose a video file to upload");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const durationSec = await readVideoDuration(file);
      if (durationSec < 10) {
        setError("Video must be at least 10 seconds long");
        setLoading(false);
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("topic", topic);
      formData.append("durationSec", String(durationSec));

      const res = await fetch("/api/projects/repurpose", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      setLoading(false);

      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }

      router.push(`/dashboard/projects/${data.projectId}`);
    } catch {
      setLoading(false);
      setError("Could not read that video file. Try a different format (mp4 recommended).");
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
          <Scissors className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Repurpose long-form video</h1>
          <p className="text-sm text-muted-foreground">
            Upload a podcast or long video. We'll cut it into vertical highlight clips.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload</CardTitle>
          <CardDescription>10 credits per source video (covers all generated clips)</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="file">Video file</Label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-sm text-muted-foreground transition-colors hover:border-primary/50"
              >
                <UploadCloud className="h-6 w-6" />
                {fileName ? fileName : "Click to choose a video (mp4, mov)"}
              </button>
              <input
                ref={fileInputRef}
                id="file"
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="topic">What's this video about? (optional, improves clip titles)</Label>
              <Input
                id="topic"
                placeholder="e.g. A podcast episode about building startups from zero"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Uploading & starting render…" : "Generate clips"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
