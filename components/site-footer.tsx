import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-muted-foreground md:flex-row">
        <p>© {new Date().getFullYear()} Clipforge. All rights reserved.</p>
        <div className="flex gap-6">
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
          <a href="mailto:sharma0810anshuman@gmail.com" className="hover:text-foreground">Contact</a>
        </div>
      </div>
    </footer>
  );
}
