"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/dashboard/ideas", label: "Generate ideas" },
  { href: "/dashboard/trends", label: "Track trends" },
] as const;

export function DiscoverTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Discover tools" className="mb-6 inline-flex rounded-lg border border-border bg-card/70 p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? "page" : undefined}
          className={cn(
            "rounded-md px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
            pathname === tab.href && "bg-primary/10 text-primary"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
