"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AspectRatioPicker } from "@/components/aspect-ratio-picker";
import { ArrowLeft, Scissors, Settings2, UploadCloud } from "lucide-react";
import Link from "next/link";
import type { AspectRatio } from "@/lib/aspect-ratio";
import { GenerationOperation } from "@/lib/generation-client";

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
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Owns this wizard's operation id across its full retry lifecycle -- see
  // lib/generation-client.ts for exactly when it's retained vs cleared. A
  // stable instance for the component's lifetime (never re-created, never
  // triggers a re-render).
  const [operation] = useState(() => new GenerationOperation());

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return; // re-entrancy guard against a double-click firing two submits

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Please choose a video file to upload");
      return;
    }

    const operationId = operation.begin();

    setLoading(true);
    setError(null);

    // Reading video metadata never leaves the browser -- no HTTP request has
    // been sent yet, so a failure here provably never touched a reservation.
    // Safe to clear and let the next click start a genuinely fresh attempt.
    let durationSec: number;
    try {
      durationSec = await readVideoDuration(file);
    } catch {
      operation.onPreRequestValidationError();
      setLoading(false);
      setError("Could not read that video file. Try a different format (mp4 recommended).");
      return;
    }
    if (durationSec < 10) {
      operation.onPreRequestValidationError();
      setLoading(false);
      setError("Video must be at least 10 seconds long");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("topic", topic);
    formData.append("durationSec", String(durationSec));
    formData.append("aspectRatio", aspectRatio);

    let res: Response;
    try {
      res = await fetch("/api/projects/repurpose", {
        method: "POST",
        headers: { "Idempotency-Key": operationId },
        body: formData,
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
      <Link href="/dashboard/create" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to video types
      </Link>
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
          <Scissors className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-xs font-medium text-primary">Step 2 of 2</p>
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
            <details className="group rounded-xl border border-border/70 bg-secondary/20 p-4">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
                <Settings2 className="h-4 w-4 text-primary" /> Customize clip format (optional)
                <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">Vertical 9:16</span>
              </summary>
              <div className="mt-4 space-y-1.5 border-t border-border/70 pt-4">
                <Label>Format</Label>
                <AspectRatioPicker value={aspectRatio} onChange={setAspectRatio} />
                <p className="text-xs text-muted-foreground">1:1 and 16:9 are a Business-plan feature.</p>
              </div>
            </details>
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
