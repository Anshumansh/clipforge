import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="glass sticky top-0 z-40 border-b border-border">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="group flex items-center gap-2 font-display font-semibold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-[hsl(262_83%_66%)] to-[hsl(316_80%_62%)] transition-transform duration-200 group-hover:rotate-6">
            <Sparkles className="h-4 w-4 text-white" />
          </span>
          <span>Clipforge</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <Link href="/#features" className="transition-colors hover:text-foreground">Features</Link>
          <Link href="/how-it-works" className="transition-colors hover:text-foreground">How it works</Link>
          <div className="group relative">
            <button className="flex items-center gap-1 transition-colors hover:text-foreground">
              Solutions
              <svg viewBox="0 0 12 12" className="h-3 w-3 fill-none stroke-current transition-transform group-hover:rotate-180">
                <path d="M2.5 4.5L6 8l3.5-3.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="invisible absolute left-0 top-full w-56 pt-3 opacity-0 transition-all group-hover:visible group-hover:opacity-100">
              <div className="rounded-lg border border-border bg-card p-1.5 shadow-lg">
                <Link href="/for/podcasters" className="block rounded-md px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground">For podcasters</Link>
                <Link href="/for/ecommerce" className="block rounded-md px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground">For e-commerce</Link>
                <Link href="/for/agencies" className="block rounded-md px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground">For agencies</Link>
                <div className="my-1.5 border-t border-border" />
                <Link href="/vs/opus-clip" className="block rounded-md px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground">vs Opus Clip</Link>
                <Link href="/vs/revid-ai" className="block rounded-md px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground">vs Revid.ai</Link>
              </div>
            </div>
          </div>
          <Link href="/pricing" className="transition-colors hover:text-foreground">Pricing</Link>
          <Link href="/#faq" className="transition-colors hover:text-foreground">FAQ</Link>
        </nav>
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/register">Start free</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
