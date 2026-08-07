import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { ProjectStatus } from "@/components/project-status";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const project = await db.project.findUnique({ where: { id: params.id }, select: { title: true } });
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
