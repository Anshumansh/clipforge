"use client";

import { ASPECT_RATIOS, ASPECT_RATIO_LABELS, type AspectRatio } from "@/lib/aspect-ratio";
import { Lock } from "lucide-react";
import { useCurrentPlan } from "@/components/plan-provider";

export function AspectRatioPicker({
  value,
  onChange,
}: {
  value: AspectRatio;
  onChange: (value: AspectRatio) => void;
}) {
  const plan = useCurrentPlan();

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {ASPECT_RATIOS.map((ratio) => {
        const isDefault = ratio === "9:16";
        const isActive = value === ratio;
        const isLocked = !isDefault && plan !== "business";
        return (
          <button
            key={ratio}
            type="button"
            onClick={() => onChange(ratio)}
            disabled={isLocked}
            aria-describedby={isLocked ? `format-${ratio}-requirement` : undefined}
            className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
              isActive ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
            } ${isLocked ? "cursor-not-allowed opacity-55 hover:bg-transparent" : ""}`}
          >
            <span className="flex items-center gap-1.5 font-medium">
              {ratio}
              {isLocked && <Lock className="h-3 w-3" aria-hidden="true" />}
            </span>
            <span className="text-xs text-muted-foreground">{ASPECT_RATIO_LABELS[ratio].split(" — ")[1]}</span>
            {isLocked && <span id={`format-${ratio}-requirement`} className="text-[10px] text-muted-foreground">Business</span>}
          </button>
        );
      })}
    </div>
  );
}
