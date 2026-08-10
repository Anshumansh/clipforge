import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMany = vi.fn();
const update = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { user: { updateMany: (...args: unknown[]) => updateMany(...args), update: (...args: unknown[]) => update(...args) } },
}));

const { chargeCredits, refundCredits, InsufficientCreditsError, CREDITS_PER_VIDEO } = await import("./credits");

describe("chargeCredits", () => {
  beforeEach(() => {
    updateMany.mockReset();
  });

  it("decrements atomically with a balance guard in the same query", async () => {
    updateMany.mockResolvedValue({ count: 1 });

    await chargeCredits("user-1", CREDITS_PER_VIDEO);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", credits: { gte: CREDITS_PER_VIDEO } },
      data: { credits: { decrement: CREDITS_PER_VIDEO } },
    });
  });

  it("throws InsufficientCreditsError when the guarded update matches no row", async () => {
    // count: 0 is what Postgres returns when the WHERE clause's credits >= amount
    // guard excludes the row -- this is the actual concurrency-safety mechanism,
    // not just an error-message nicety, so it's worth pinning down in a test.
    updateMany.mockResolvedValue({ count: 0 });

    await expect(chargeCredits("user-1", 999)).rejects.toBeInstanceOf(InsufficientCreditsError);
  });
});

describe("refundCredits", () => {
  beforeEach(() => {
    update.mockReset();
  });

  it("increments the user's balance by the exact charged amount", async () => {
    update.mockResolvedValue({});

    await refundCredits("user-1", CREDITS_PER_VIDEO);

    expect(update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { credits: { increment: CREDITS_PER_VIDEO } },
    });
  });
});
