import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function slugId() {
  return Math.random().toString(36).slice(2, 10);
}

// Deliberately local, not iso.slice(0, 10) (which gives the UTC date) --
// callers key a local-calendar grid off Date's local getters (getFullYear/
// getMonth), so a UTC-based key silently misplaces items for anyone west
// of UTC: an evening-local timestamp is already "tomorrow" in UTC. A
// calendar is an inherently local-time concept -- "what day is this on"
// means the viewer's day.
export function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
