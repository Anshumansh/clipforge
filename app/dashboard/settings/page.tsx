import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SOCIAL_PLATFORMS, PLATFORM_LABELS, isPlatformConfigured } from "@/lib/social/platforms";
import { ConnectedAccountRow } from "@/components/connected-account-row";
import { AlertTriangle, ArrowRight, CheckCircle2, CreditCard, KeyRound, Palette, Share2, Users } from "lucide-react";
import { canUseSocialPublishing } from "@/lib/plans";

export const metadata: Metadata = { title: "Settings" };

const settingLinks = [
  {
    href: "/dashboard/settings/brand",
    title: "Brand kit",
    description: "Set the colors, logo and font used in your videos.",
    icon: Palette,
  },
  {
    href: "/dashboard/settings/team",
    title: "Team",
    description: "Invite teammates and share a Business workspace.",
    icon: Users,
  },
  {
    href: "/dashboard/billing",
    title: "Plan and billing",
    description: "See credits, change your plan or manage payment details.",
    icon: CreditCard,
  },
  {
    href: "/dashboard/settings/api-keys",
    title: "API access",
    description: "Create and revoke API keys for approved Business accounts.",
    icon: KeyRound,
  },
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ social_connected?: string; social_error?: string }>;
}) {
  const query = await searchParams;
  const user = await requireUser();
  const accounts = await db.socialAccount.findMany({
    where: { userId: user.id },
    select: { id: true, platform: true, handle: true },
  });
  const accountByPlatform = new Map(accounts.map((a) => [a.platform, a]));
  const canPublish = canUseSocialPublishing(user.plan);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your brand, team, plan, API access and publishing accounts.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {settingLinks.map((item) => (
          <Link key={item.href} href={item.href} className="group focus:outline-none">
            <Card className="h-full transition-colors group-hover:border-primary/50 group-focus-visible:ring-2 group-focus-visible:ring-primary">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </div>
                <CardTitle className="pt-2 text-base">{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      {query.social_connected && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-500">
          <CheckCircle2 className="h-4 w-4" /> {PLATFORM_LABELS[query.social_connected as keyof typeof PLATFORM_LABELS] ?? query.social_connected} connected.
        </div>
      )}
      {query.social_error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> Couldn't connect that account ({query.social_error}). Try again.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Share2 className="h-5 w-5 text-primary" /> Connected accounts</CardTitle>
          <CardDescription>
            {canPublish
              ? "Connect one account per platform to publish finished videos. Disconnect any time."
              : "Direct publishing is included with Creator and Business. You can still create and download videos on Free."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {SOCIAL_PLATFORMS.map((platform) => (
            <ConnectedAccountRow
              key={platform}
              platform={platform}
              label={PLATFORM_LABELS[platform]}
              connected={accountByPlatform.get(platform) ?? null}
              configured={isPlatformConfigured(platform)}
              entitled={canPublish}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
