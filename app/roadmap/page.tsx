import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { RoadmapBoard } from "@/components/roadmap-board";

export const metadata: Metadata = {
  title: "Roadmap",
  description: "Suggest a feature or see what other creators want next from Clipforge.",
};

export const dynamic = "force-dynamic";

export default async function RoadmapPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [requests, currentUser] = await Promise.all([
    db.featureRequest.findMany({
      include: { votes: { select: { userId: true } } },
      orderBy: { createdAt: "desc" },
    }),
    userId ? db.user.findUnique({ where: { id: userId }, select: { isAdmin: true } }) : null,
  ]);

  const items = requests
    .map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      voteCount: r.votes.length,
      hasVoted: userId ? r.votes.some((v) => v.userId === userId) : false,
    }))
    .sort((a, b) => b.voteCount - a.voteCount);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1 px-6 py-16">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight">Roadmap</h1>
          <p className="mt-3 text-muted-foreground">
            Vote on what we should build next, or suggest something that's missing. Real requests, not a formality.
          </p>

          <RoadmapBoard initialItems={items} loggedIn={!!userId} isAdmin={!!currentUser?.isAdmin} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
