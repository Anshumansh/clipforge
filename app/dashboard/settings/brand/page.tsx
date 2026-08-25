import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { canUseBrandKit } from "@/lib/plans";
import { BrandKitForm } from "@/components/brand-kit-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Brand kit" };

export default async function BrandSettingsPage() {
  const user = await requireUser();
  if (!canUseBrandKit(user.plan)) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Brand kit</h1>
          <p className="text-sm text-muted-foreground">Keep every render consistent with your logo, colors, and font.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Business plan required</CardTitle>
            <CardDescription>Apply one shared visual identity automatically to every generated video.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><a href="/pricing">View plans</a></Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  const kit = await db.brandKit.findUnique({ where: { userId: user.id } });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Brand kit</h1>
        <p className="text-sm text-muted-foreground">
          Keep every render consistent with your logo, colors, and font.
        </p>
      </div>

      <BrandKitForm
        initial={{
          logoUrl: kit?.logoUrl ?? null,
          primaryColor: kit?.primaryColor ?? null,
          secondaryColor: kit?.secondaryColor ?? null,
          fontFamily: kit?.fontFamily ?? null,
        }}
      />
    </div>
  );
}
