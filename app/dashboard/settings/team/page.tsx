import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { TeamManager } from "@/components/team-manager";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  await requireUser();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Team</h1>
        <p className="text-sm text-muted-foreground">
          Invite teammates to share your project pipeline and credit balance.
        </p>
      </div>

      <TeamManager />
    </div>
  );
}
