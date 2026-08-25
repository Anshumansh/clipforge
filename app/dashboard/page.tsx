import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { getWorkspaceContext } from "@/lib/workspace";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StreakCard } from "@/components/streak-card";
import { formatDate } from "@/lib/utils";
import { ArrowRight, CheckCircle2, Clapperboard, Clock3, Coins, Lightbulb, Plus, Scissors, UserRound, Wand2 } from "lucide-react";

export const metadata: Metadata = { title: "Your video workspace" };

const typeIcon = { script: Wand2, repurpose: Scissors, ugc: UserRound } as const;
const typeLabel = { script: "Script to video", repurpose: "Repurpose", ugc: "UGC ad" } as const;

const statusVariant = {
  draft: "outline",
  queued: "secondary",
  processing: "warning",
  ready: "success",
  failed: "destructive",
} as const;

export default async function DashboardPage() {
  const user = await requireUser();
  const workspaceCtx = await getWorkspaceContext(user.id);
  const projects = await db.project.findMany({
    where: workspaceCtx ? { OR: [{ userId: user.id }, { workspaceId: workspaceCtx.workspaceId }] } : { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { email: true } } },
  });
  const activeProjects = projects.filter((project) => project.status === "queued" || project.status === "processing").length;
  const readyProjects = projects.filter((project) => project.status === "ready").length;

  return (
    <div>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold">Your video workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create, review, and publish every video from one place.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/ideas"><Lightbulb className="mr-1.5 h-4 w-4" /> Find ideas</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/dashboard/create"><Plus className="mr-1.5 h-4 w-4" /> Create video</Link>
          </Button>
        </div>
      </div>

      {projects.length === 0 ? (
        <Card className="ambient-glow relative overflow-hidden border-dashed px-6 py-12 sm:px-10">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20">
              <Clapperboard className="h-7 w-7 text-primary" />
            </div>
            <div className="mt-4">
              <p className="text-lg font-semibold">Create your first video in three simple steps</p>
              <p className="mt-1 text-sm text-muted-foreground">Choose a format, add your content, and let Clipforge build the video.</p>
            </div>
            <div className="mx-auto my-6 grid max-w-xl gap-3 text-left sm:grid-cols-3">
              {["Choose a format", "Add your content", "Generate & download"].map((step, index) => (
                <div key={step} className="rounded-xl border border-border/70 bg-background/60 p-3 text-sm">
                  <span className="mb-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
                  {step}
                </div>
              ))}
            </div>
            <Button asChild size="lg">
              <Link href="/dashboard/create">Start creating <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="mb-8 grid gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <Coins className="h-5 w-5 text-primary" />
                <div><p className="text-lg font-semibold">{user.credits}</p><p className="text-xs text-muted-foreground">Credits available</p></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <Clock3 className="h-5 w-5 text-amber-500" />
                <div><p className="text-lg font-semibold">{activeProjects}</p><p className="text-xs text-muted-foreground">Generating now</p></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <div><p className="text-lg font-semibold">{readyProjects}</p><p className="text-xs text-muted-foreground">Ready to publish</p></div>
              </CardContent>
            </Card>
          </div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Recent projects</h2>
            <span className="text-sm text-muted-foreground">{projects.length} total</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const Icon = typeIcon[project.type as keyof typeof typeIcon] ?? Wand2;
              return (
                <Link key={project.id} href={`/dashboard/projects/${project.id}`} className="group">
                  <Card className="h-full transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/50 group-hover:shadow-lg group-hover:shadow-primary/10">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-accent/20">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <Badge variant={statusVariant[project.status as keyof typeof statusVariant] ?? "outline"}>
                          {project.status}
                        </Badge>
                      </div>
                      <CardTitle className="line-clamp-2 text-base">{project.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span>{typeLabel[project.type as keyof typeof typeLabel] ?? project.type}</span>
                        <span>{formatDate(project.createdAt)}</span>
                      </div>
                      {project.userId !== user.id && <p className="truncate">by {project.user.email}</p>}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
          <div className="mt-8"><StreakCard currentStreak={user.currentStreak} longestStreak={user.longestStreak} /></div>
        </>
      )}
    </div>
  );
}
