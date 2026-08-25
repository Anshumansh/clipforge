import { Coins, FolderCheck, RotateCcw } from "lucide-react";

export function GenerationSummary({ description = "one finished video" }: { description?: string }) {
  return (
    <div className="grid gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground sm:grid-cols-3">
      <div className="flex items-start gap-2">
        <Coins className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span><strong className="text-foreground">10 credits</strong> for {description}</span>
      </div>
      <div className="flex items-start gap-2">
        <FolderCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>Progress is saved in your Projects</span>
      </div>
      <div className="flex items-start gap-2">
        <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>Reserved credits return if generation fails</span>
      </div>
    </div>
  );
}
