"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, localDateKey } from "@/lib/utils";

interface ScheduleItem {
  id: string;
  platform: string;
  handle: string | null;
  caption: string;
  status: string;
  scheduledAt: string;
  errorMessage: string | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube Shorts",
  tiktok: "TikTok",
  instagram: "Instagram Reels",
};

const STATUS_VARIANT: Record<string, "outline" | "warning" | "success" | "destructive"> = {
  scheduled: "outline",
  posting: "warning",
  posted: "success",
  failed: "destructive",
};

const dateKey = localDateKey;

export function ScheduleCalendar({ items }: { items: ScheduleItem[] }) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    for (const item of items) {
      const key = dateKey(item.scheduledAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [items]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = firstOfMonth.getDay();
  const todayKey = dateKey(new Date().toISOString());

  const cells: { day: number; key: string }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, key });
  }

  const upcoming = items.filter((i) => new Date(i.scheduledAt).getTime() >= Date.now() - 24 * 60 * 60 * 1000);
  const displayed = selectedDay ? items.filter((i) => dateKey(i.scheduledAt) === selectedDay) : upcoming;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold">
            {viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </p>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewDate(new Date(year, month - 1, 1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewDate(new Date(year, month + 1, 1))}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
          {Array.from({ length: startWeekday }).map((_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {cells.map(({ day, key }) => {
            const count = itemsByDay.get(key)?.length ?? 0;
            const isToday = key === todayKey;
            const isSelected = key === selectedDay;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedDay(isSelected ? null : key)}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-lg border border-transparent py-2 text-sm transition-colors",
                  isSelected ? "border-primary/60 bg-primary/15" : "hover:bg-secondary/50",
                  isToday && !isSelected && "border-border"
                )}
              >
                <span className={isToday ? "font-semibold text-primary" : undefined}>{day}</span>
                {count > 0 && <span className="h-1 w-1 rounded-full bg-primary" />}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {selectedDay
              ? new Date(selectedDay + "T00:00:00").toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })
              : "Upcoming"}
          </h2>
          {selectedDay && (
            <button type="button" onClick={() => setSelectedDay(null)} className="text-xs text-primary underline underline-offset-2 hover:no-underline">
              Show all upcoming
            </button>
          )}
        </div>

        {displayed.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled here yet.</p>
        ) : (
          <div className="space-y-2">
            {displayed.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card/40 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{PLATFORM_LABELS[item.platform] ?? item.platform}</span>
                    {item.handle && <span className="text-xs text-muted-foreground">@{item.handle}</span>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.caption || "(no caption)"}</p>
                  {item.status === "failed" && item.errorMessage && (
                    <p className="mt-0.5 text-xs text-destructive">{item.errorMessage}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant={STATUS_VARIANT[item.status] ?? "outline"}>{item.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(item.scheduledAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
