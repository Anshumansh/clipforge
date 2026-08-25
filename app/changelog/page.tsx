import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { changelog } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What's shipped on Clipforge, most recent first.",
};

const TAG_VARIANT: Record<string, "success" | "outline" | "destructive"> = {
  New: "success",
  Improved: "outline",
  Fixed: "destructive",
};

export default function ChangelogPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1 px-6 py-16">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight">Changelog</h1>
          <p className="mt-3 text-muted-foreground">
            What's actually shipped, most recent first. Have a request instead? See the{" "}
            <Link href="/roadmap" className="text-primary hover:underline">
              roadmap board
            </Link>
            .
          </p>

          <div className="mt-10 space-y-8 border-l border-border pl-6">
            {changelog.map((entry) => (
              <div key={entry.title} className="relative">
                <div className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                <p className="text-xs text-muted-foreground">
                  {new Date(entry.date + "T00:00:00Z").toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "UTC",
                  })}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Badge variant={TAG_VARIANT[entry.tag] ?? "outline"}>{entry.tag}</Badge>
                  <h2 className="font-semibold">{entry.title}</h2>
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">{entry.description}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
