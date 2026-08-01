import { requireUser } from "@/lib/session";
import { DashboardNav } from "@/components/dashboard-nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <DashboardNav credits={user.credits} />
      <main className="min-h-screen flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
    </div>
  );
}
