import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { ProjectStatus } from "@/components/project-status";

// Scoped to the requesting user, same as the page body below — without this,
// another user's private project title (which can be sensitive: a UGC ad's
// product/brand, a personal script topic) would leak into the page's <title>
// and meta description for anyone who requested this URL, logged in or not,
// even though the page content itself correctly 404s for them.
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { title: "Project" };

  const project = await db.project.findFirst({ where: { id: params.id, userId }, select: { title: true } });
  return { title: project?.title ?? "Project" };
}

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const project = await db.project.findFirst({
    where: { id: params.id, userId: user.id },
    include: { clips: { orderBy: { score: "desc" } }, jobs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  if (!project) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <ProjectStatus
        initial={{
          id: project.id,
          type: project.type,
          title: project.title,
          status: project.status,
          videoUrl: project.videoUrl,
          thumbnailUrl: project.thumbnailUrl,
          errorMessage: project.errorMessage,
          clips: project.clips,
          job: project.jobs[0]
            ? { status: project.jobs[0].status, progress: project.jobs[0].progress, log: project.jobs[0].log }
            : null,
        }}
      />
    </div>
  );
}
