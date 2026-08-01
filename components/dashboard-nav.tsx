"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Coins, CreditCard, LayoutGrid, LogOut, Menu, Scissors, Sparkles, UserRound, Wand2, X } from "lucide-react";

const links = [
  { href: "/dashboard", label: "Projects", icon: LayoutGrid, exact: true },
  { href: "/dashboard/new/script", label: "Script to video", icon: Wand2 },
  { href: "/dashboard/new/repurpose", label: "Repurpose", icon: Scissors },
  { href: "/dashboard/new/ugc", label: "UGC / Avatar ad", icon: UserRound },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
];

export function DashboardNav({ credits }: { credits: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <div className="flex h-14 items-center justify-between border-b border-border/60 px-4 md:hidden">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Sparkles className="h-5 w-5 text-primary" /> Clipforge
        </Link>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setOpen(false)} aria-hidden="true" />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-border/60 bg-background p-4 transition-transform duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="mb-8 flex items-center justify-between px-2">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-5 w-5 text-primary" /> Clipforge
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
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  active && "bg-muted text-foreground"
                )}
              >
                <link.icon className="h-4 w-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-3 border-t border-border/60 pt-4">
          <Badge variant="secondary" className="w-full justify-center gap-1.5 py-1.5">
            <Coins className="h-3.5 w-3.5" /> {credits} credits
          </Badge>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={() => signOut({ callbackUrl: "/" })}>
            <LogOut className="h-4 w-4" /> Log out
          </Button>
        </div>
      </aside>
    </>
  );
}
