"use client";

import { useState } from "react";
import { Download, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThumbnailGenerator({ projectId, initialUrl }: { projectId: string; initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/thumbnail`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    setUrl(data.thumbnailUrl);
  }

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Thumbnail</p>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={loading} onClick={generate}>
          <ImagePlus className="h-3.5 w-3.5" />
          {loading ? "Generating…" : url ? "Regenerate" : "Generate thumbnail"}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {url && (
        <div className="mt-3">
          <img src={url} alt="Generated thumbnail" className="w-full rounded-md" />
          <a href={url} download className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
            <Download className="h-3.5 w-3.5" /> Download
          </a>
        </div>
      )}
    </div>
  );
}
