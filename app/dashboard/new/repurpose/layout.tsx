import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { canUseRepurpose } from "@/lib/plans";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Repurpose long-form video" };

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  if (!canUseRepurpose(user.plan)) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Paid plan required</CardTitle>
            <CardDescription>
              Repurpose long-form video into highlight clips is available on the Hobby, Creator, and
              Business plans.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Upgrade to any paid plan to upload a podcast or long video and get AI-generated
              short-form clips automatically.
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
