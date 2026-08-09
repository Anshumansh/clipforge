import { db } from "@/lib/db";
import { canUseBrandKit } from "@/lib/plans";
import { resolveCreditOwnerId } from "@/lib/workspace";
import type { BrandSettings } from "@/lib/brand";

/** Fetches a brand kit for use in a render, already gated by plan -- every
 * job runner can just pass the result straight to a composition's `brand`
 * prop without re-checking canUseBrandKit itself. Returns undefined both
 * when there's no kit saved and when the applicable plan can't apply one,
 * since the render path treats both identically (fall back to defaults).
 *
 * Resolves through workspace context (lib/workspace.ts): a workspace
 * member's render uses the OWNER's plan and the OWNER's brand kit, not
 * their own -- they're spending the owner's credits, so they get the
 * owner's tier of service and the team's shared identity, not a mix of
 * their own (possibly free-tier) settings.
 *
 * Deliberately separate from lib/brand.ts, which remotion/ScriptVideo.tsx
 * and remotion/RepurposeClip.tsx import directly -- those get bundled by
 * Remotion's own (browser-target) bundler, which should never need to
 * resolve the Prisma client. */
export async function getBrandForRender(renderingUserId: string): Promise<BrandSettings | undefined> {
  const ownerId = await resolveCreditOwnerId(renderingUserId);
  const owner = await db.user.findUniqueOrThrow({ where: { id: ownerId }, select: { plan: true } });
  if (!canUseBrandKit(owner.plan)) return undefined;

  const kit = await db.brandKit.findUnique({ where: { userId: ownerId } });
  if (!kit) return undefined;
  if (!kit.logoUrl && !kit.primaryColor && !kit.secondaryColor && !kit.fontFamily) return undefined;

  return {
    logoUrl: kit.logoUrl,
    primaryColor: kit.primaryColor,
    secondaryColor: kit.secondaryColor,
    fontFamily: kit.fontFamily,
  };
}
