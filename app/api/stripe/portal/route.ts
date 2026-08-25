import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { getPublicAppOrigin } from "@/lib/public-app-url";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.stripeCustomerId) {
      return NextResponse.json({ error: "No billing account yet — subscribe to a plan first" }, { status: 400 });
    }

    const stripe = getStripe();
    const origin = getPublicAppOrigin(req.url);

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${origin}/dashboard/billing`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    console.error("Unable to open Stripe billing portal", error);
    return NextResponse.json(
      { error: "Billing is temporarily unavailable. Please try again in a moment." },
      { status: 503 }
    );
  }
}
