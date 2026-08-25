"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AspectRatioPicker } from "@/components/aspect-ratio-picker";
import { UserRound } from "lucide-react";
import type { AspectRatio } from "@/lib/aspect-ratio";
import { GenerationOperation } from "@/lib/generation-client";

export default function NewUgcAdPage() {
  const router = useRouter();
  const [productName, setProductName] = useState("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [ctaText, setCtaText] = useState("");
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

    const operationId = operation.begin();

    setLoading(true);
    setError(null);

    let res: Response;
    try {
      res = await fetch("/api/projects/ugc", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": operationId },
        body: JSON.stringify({ productName, sellingPoints, ctaText, aspectRatio }),
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
          <UserRound className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">UGC ad</h1>
          <p className="text-sm text-muted-foreground">
            A voiceover-led, UGC-style ad script with captions and a CTA end card. No camera needed.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Product details</CardTitle>
          <CardDescription>10 credits per video</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="productName">Product name</Label>
              <Input id="productName" required value={productName} onChange={(e) => setProductName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sellingPoints">Key selling points</Label>
              <Textarea
                id="sellingPoints"
                required
                rows={5}
                placeholder="One per line: e.g. Ships free in 2 days, 30-day money-back guarantee, made from recycled materials"
                value={sellingPoints}
                onChange={(e) => setSellingPoints(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ctaText">Call to action (optional)</Label>
              <Input
                id="ctaText"
                placeholder="e.g. Use code SAVE20 at checkout"
                value={ctaText}
                onChange={(e) => setCtaText(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Format</Label>
              <AspectRatioPicker value={aspectRatio} onChange={setAspectRatio} />
              <p className="text-xs text-muted-foreground">1:1 and 16:9 are a Business-plan feature.</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Starting render…" : "Generate ad video"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
