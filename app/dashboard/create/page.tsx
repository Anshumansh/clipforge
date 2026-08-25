import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileText, Scissors, ShoppingBag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Create a video" };

const formats = [
  {
    href: "/dashboard/new/script",
    title: "Start with an idea or script",
    description: "Turn a topic, outline, or complete script into a finished short video.",
    icon: FileText,
    badge: "Recommended",
    details: "Best for Shorts, Reels, explainers, and faceless videos",
  },
  {
    href: "/dashboard/new/repurpose",
    title: "Start with a long video",
    description: "Upload a podcast, webinar, or long recording and turn it into short clips.",
    icon: Scissors,
    badge: undefined,
    details: "Best for podcasts, interviews, courses, and webinars",
  },
  {
    href: "/dashboard/new/ugc",
    title: "Create a product ad",
    description: "Add your product details and generate a social-ready UGC-style ad.",
    icon: ShoppingBag,
    badge: undefined,
    details: "Best for products, offers, launches, and paid social",
  },
] as const;

export default function CreateVideoPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <p className="text-sm font-medium text-primary">Step 1 of 2</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">What do you want to create?</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Choose what you already have. We&apos;ll show only the fields you need next.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {formats.map((format) => (
          <Link key={format.href} href={format.href} className="group focus:outline-none">
            <Card className="flex h-full flex-col transition-all duration-200 group-hover:-translate-y-1 group-hover:border-primary/60 group-hover:shadow-xl group-hover:shadow-primary/10 group-focus-visible:ring-2 group-focus-visible:ring-primary">
              <CardHeader>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-accent/20">
                    <format.icon className="h-6 w-6 text-primary" />
                  </span>
                  {format.badge && <Badge variant="secondary">{format.badge}</Badge>}
                </div>
                <CardTitle className="text-lg">{format.title}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <p className="text-sm leading-6 text-muted-foreground">{format.description}</p>
                <p className="mt-4 border-t border-border/70 pt-4 text-xs text-muted-foreground">{format.details}</p>
                <span className="mt-auto flex items-center pt-6 text-sm font-semibold text-primary">
                  Continue <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Not sure? Start with <Link href="/dashboard/new/script" className="font-medium text-primary hover:underline">an idea or script</Link> — it&apos;s the fastest path.
      </p>
    </div>
  );
}
