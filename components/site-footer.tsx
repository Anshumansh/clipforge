import Link from "next/link";
import { Sparkles } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-muted-foreground md:flex-row">
        <Link href="/" className="flex items-center gap-2 font-display font-medium text-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          Clipforge
        </Link>
        <p>© {new Date().getFullYear()} Clipforge. All rights reserved.</p>
        <div className="flex flex-wrap justify-center gap-6">
          <Link href="/how-it-works" className="transition-colors hover:text-foreground">How it works</Link>
          <Link href="/for/podcasters" className="transition-colors hover:text-foreground">For podcasters</Link>
          <Link href="/for/ecommerce" className="transition-colors hover:text-foreground">For e-commerce</Link>
          <Link href="/for/agencies" className="transition-colors hover:text-foreground">For agencies</Link>
          <Link href="/vs/opus-clip" className="transition-colors hover:text-foreground">vs Opus Clip</Link>
          <Link href="/vs/revid-ai" className="transition-colors hover:text-foreground">vs Revid.ai</Link>
          <Link href="/changelog" className="transition-colors hover:text-foreground">Changelog</Link>
          <Link href="/roadmap" className="transition-colors hover:text-foreground">Roadmap</Link>
          <Link href="/trust" className="transition-colors hover:text-foreground">Trust</Link>
          <Link href="/privacy" className="transition-colors hover:text-foreground">Privacy</Link>
          <Link href="/terms" className="transition-colors hover:text-foreground">Terms</Link>
          <a href="mailto:support@forgecut.app" className="transition-colors hover:text-foreground">Contact</a>
        </div>
      </div>
    </footer>
  );
}
