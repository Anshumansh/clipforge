import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const projects = await db.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
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
        <Card className="flex flex-col items-center gap-4 py-16 text-center">
          <Clapperboard className="h-10 w-10 text-muted-foreground" />
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
              <Link key={project.id} href={`/dashboard/projects/${project.id}`}>
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <Badge variant={statusVariant[project.status as keyof typeof statusVariant] ?? "outline"}>
                        {project.status}
                      </Badge>
                    </div>
                    <CardTitle className="line-clamp-2 text-base">{project.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{typeLabel[project.type as keyof typeof typeLabel] ?? project.type}</span>
                    <span>{formatDate(project.createdAt)}</span>
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
