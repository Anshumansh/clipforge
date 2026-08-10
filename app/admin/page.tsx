import type { Metadata } from "next";
import { requireAdmin } from "@/lib/session";
import { AdminPanel } from "@/components/admin-panel";
import { AdminMfaCard } from "@/components/admin-mfa-card";
import { AdminReconciliationCard } from "@/components/admin-reconciliation-card";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const adminUser = await requireAdmin();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-sm text-muted-foreground">Look up an account to grant credits or comp a plan.</p>
      </div>
      <AdminMfaCard initiallyEnabled={Boolean(adminUser.totpEnabledAt)} />
      <AdminPanel />
      <AdminReconciliationCard />
    </div>
  );
}
