import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { DashboardNav } from "@/components/dashboard-nav";
import { VerifyEmailBanner } from "@/components/verify-email-banner";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <DashboardNav credits={user.credits} streak={user.currentStreak} />
      <main className="min-h-screen flex-1 overflow-y-auto p-4 md:p-8">
        {!user.emailVerifiedAt && <VerifyEmailBanner />}
        {children}
      </main>
    </div>
  );
}
