"use client";

import { ASPECT_RATIOS, ASPECT_RATIO_LABELS, type AspectRatio } from "@/lib/aspect-ratio";
import { Sparkles } from "lucide-react";

export function AspectRatioPicker({
  value,
  onChange,
}: {
  value: AspectRatio;
  onChange: (value: AspectRatio) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {ASPECT_RATIOS.map((ratio) => {
        const isDefault = ratio === "9:16";
        const isActive = value === ratio;
        return (
          <button
            key={ratio}
            type="button"
            onClick={() => onChange(ratio)}
            className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
              isActive ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
            }`}
          >
            <span className="flex items-center gap-1.5 font-medium">
              {ratio}
              {!isDefault && <Sparkles className="h-3 w-3 text-primary" />}
            </span>
            <span className="text-xs text-muted-foreground">{ASPECT_RATIO_LABELS[ratio].split(" — ")[1]}</span>
          </button>
        );
      })}
    </div>
  );
}
