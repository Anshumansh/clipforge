import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { canUseUgc } from "@/lib/plans";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "UGC ad" };

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  if (!canUseUgc(user.plan)) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Creator plan required</CardTitle>
            <CardDescription>
              The UGC Ad Generator is available on the Creator and Business plans.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Upgrade to the Creator plan to generate voiceover-led, UGC-style product ads with
              captions and a CTA end card.
            </p>
            <Button asChild>
              <a href="/pricing">View plans</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
