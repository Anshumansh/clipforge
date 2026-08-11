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
import { Clapperboard, Plus, Scissors, UserRound, Wand2 } from "lucide-react";

export const metadata: Metadata = { title: "Your projects" };

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

  return (
    <div>
      <StreakCard currentStreak={user.currentStreak} longestStreak={user.longestStreak} />
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Your projects</h1>
          <p className="text-sm text-muted-foreground">{projects.length} total</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/new/repurpose"><Scissors className="mr-1.5 h-4 w-4" /> Repurpose</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/new/ugc"><UserRound className="mr-1.5 h-4 w-4" /> UGC ad</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/dashboard/new/script"><Plus className="mr-1.5 h-4 w-4" /> New video</Link>
          </Button>
        </div>
      </div>

      {projects.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 border-dashed py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20">
            <Clapperboard className="h-7 w-7 text-primary" />
          </div>
          <div>
            <p className="font-medium">No projects yet</p>
            <p className="text-sm text-muted-foreground">Generate your first video to see it here.</p>
          </div>
          <Button asChild>
            <Link href="/dashboard/new/script">Create a video</Link>
          </Button>
        </Card>
      ) : (
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
      )}
    </div>
  );
}
