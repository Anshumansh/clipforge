"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Coins,
  CreditCard,
  Flame,
  LayoutGrid,
  Lightbulb,
  LogOut,
  Menu,
  Scissors,
  Share2,
  Sparkles,
  UserRound,
  Wand2,
  X,
} from "lucide-react";

const links = [
  { href: "/dashboard", label: "Projects", icon: LayoutGrid, exact: true },
  { href: "/dashboard/ideas", label: "Idea Radar", icon: Lightbulb },
  { href: "/dashboard/new/script", label: "Script to video", icon: Wand2 },
  { href: "/dashboard/new/repurpose", label: "Repurpose", icon: Scissors },
  { href: "/dashboard/new/ugc", label: "UGC / Avatar ad", icon: UserRound },
  { href: "/dashboard/settings", label: "Connected accounts", icon: Share2 },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
];

export function DashboardNav({ credits, streak }: { credits: number; streak: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <div className="glass flex h-14 items-center justify-between border-b border-border/60 px-4 md:hidden">
        <Link href="/" className="flex items-center gap-2 font-display font-semibold">
          <Sparkles className="h-5 w-5 text-primary" /> Clipforge
        </Link>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden" onClick={() => setOpen(false)} aria-hidden="true" />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-border/60 bg-background/95 p-4 transition-transform duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="mb-8 flex items-center justify-between px-2">
          <Link href="/" className="flex items-center gap-2 font-display font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-[hsl(262_83%_66%)] to-[hsl(316_80%_62%)]">
              <Sparkles className="h-4 w-4 text-white" />
            </span>
            Clipforge
          </Link>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {links.map((link) => {
            const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  active && "bg-primary/10 text-foreground"
                )}
              >
                {active && (
                  <span className="absolute -left-1 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-[hsl(262_83%_66%)] to-[hsl(316_80%_62%)]" />
                )}
                <link.icon className={cn("h-4 w-4", active && "text-primary")} />
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-3 border-t border-border/60 pt-4">
          {streak > 0 && (
            <Badge
              variant="secondary"
              className="w-full justify-center gap-1.5 border border-amber-500/30 bg-amber-500/10 py-1.5 text-amber-500"
            >
              <Flame className="h-3.5 w-3.5" /> {streak}-day streak
            </Badge>
          )}
          <Badge variant="secondary" className="w-full justify-center gap-1.5 border border-primary/20 bg-primary/10 py-1.5 text-foreground">
            <Coins className="h-3.5 w-3.5 text-primary" /> {credits} credits
          </Badge>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={() => signOut({ callbackUrl: "/" })}>
            <LogOut className="h-4 w-4" /> Log out
          </Button>
        </div>
      </aside>
    </>
  );
}
