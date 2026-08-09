import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { canUseApiAccess } from "@/lib/plans";
import { ApiKeysManager } from "@/components/api-keys-manager";

export const metadata: Metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const user = await requireUser();
  const keys = await db.apiKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, keyPrefix: true, lastUsedAt: true, createdAt: true },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API keys</h1>
        <p className="text-sm text-muted-foreground">
          Generate a video from Claude or any MCP client, connected to your Clipforge account.
        </p>
      </div>

      <ApiKeysManager
        canCreate={canUseApiAccess(user.plan)}
        initialKeys={keys.map((k) => ({
          id: k.id,
          label: k.label,
          keyPrefix: k.keyPrefix,
          lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
          createdAt: k.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
