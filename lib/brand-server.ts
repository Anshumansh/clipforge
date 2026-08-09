import { db } from "@/lib/db";
import { canUseBrandKit } from "@/lib/plans";
import type { BrandSettings } from "@/lib/brand";

/** Fetches a user's brand kit for use in a render, already gated by plan --
 * every job runner can just pass the result straight to a composition's
 * `brand` prop without re-checking canUseBrandKit itself. Returns undefined
 * both when the user has no kit saved and when their plan can't apply one,
 * since the render path treats both identically (fall back to defaults).
 *
 * Deliberately separate from lib/brand.ts, which remotion/ScriptVideo.tsx
 * and remotion/RepurposeClip.tsx import directly -- those get bundled by
 * Remotion's own (browser-target) bundler, which should never need to
 * resolve the Prisma client. */
export async function getBrandForRender(userId: string, plan: string): Promise<BrandSettings | undefined> {
  if (!canUseBrandKit(plan)) return undefined;

  const kit = await db.brandKit.findUnique({ where: { userId } });
  if (!kit) return undefined;
  if (!kit.logoUrl && !kit.primaryColor && !kit.secondaryColor && !kit.fontFamily) return undefined;

  return {
    logoUrl: kit.logoUrl,
    primaryColor: kit.primaryColor,
    secondaryColor: kit.secondaryColor,
    fontFamily: kit.fontFamily,
  };
}
