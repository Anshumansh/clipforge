import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SOCIAL_PLATFORMS, PLATFORM_LABELS, isPlatformConfigured } from "@/lib/social/platforms";
import { ConnectedAccountRow } from "@/components/connected-account-row";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = { title: "Connected accounts" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { social_connected?: string; social_error?: string };
}) {
  const user = await requireUser();
  const accounts = await db.socialAccount.findMany({
    where: { userId: user.id },
    select: { id: true, platform: true, handle: true },
  });
  const accountByPlatform = new Map(accounts.map((a) => [a.platform, a]));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Connected accounts</h1>
        <p className="text-sm text-muted-foreground">
          Connect your social accounts to publish rendered videos directly, no manual download/upload.
        </p>
      </div>

      {searchParams.social_connected && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-500">
          <CheckCircle2 className="h-4 w-4" /> {PLATFORM_LABELS[searchParams.social_connected as keyof typeof PLATFORM_LABELS] ?? searchParams.social_connected} connected.
        </div>
      )}
      {searchParams.social_error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> Couldn't connect that account ({searchParams.social_error}). Try again.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Platforms</CardTitle>
          <CardDescription>One account per platform. Disconnect any time.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {SOCIAL_PLATFORMS.map((platform) => (
            <ConnectedAccountRow
              key={platform}
              platform={platform}
              label={PLATFORM_LABELS[platform]}
              connected={accountByPlatform.get(platform) ?? null}
              configured={isPlatformConfigured(platform)}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
