import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSession = vi.fn();
const userFindUniqueOrThrow = vi.fn();
const userUpdate = vi.fn();
const customerCreate = vi.fn();
const checkoutCreate = vi.fn();
const rateLimitFn = vi.fn();

vi.mock("next-auth", () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...args: unknown[]) => rateLimitFn(...args) }));
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUniqueOrThrow: (...args: unknown[]) => userFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => userUpdate(...args),
    },
  },
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    customers: { create: (...args: unknown[]) => customerCreate(...args) },
    checkout: { sessions: { create: (...args: unknown[]) => checkoutCreate(...args) } },
  }),
}));

const { POST } = await import("./route");

function request(plan: string): Request {
  return new Request("https://staging.clipforge.test/api/stripe/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.STRIPE_PRICE_CREATOR;
  delete process.env.STRIPE_PRICE_BUSINESS;
  process.env.NEXTAUTH_URL = "https://staging.clipforge.test";
  getServerSession.mockResolvedValue({ user: { id: "user_1" } });
  rateLimitFn.mockReturnValue({ ok: true, remaining: 4, resetAt: Date.now() + 60_000 });
  userFindUniqueOrThrow.mockResolvedValue({
    id: "user_1",
    email: "creator@example.test",
    stripeCustomerId: "cus_existing",
  });
  userUpdate.mockResolvedValue({});
  customerCreate.mockResolvedValue({ id: "cus_new" });
  checkoutCreate.mockResolvedValue({ url: "https://checkout.stripe.test/session" });
});

describe("POST /api/stripe/checkout", () => {
  it("requires an authenticated user", async () => {
    getServerSession.mockResolvedValue(null);
    const response = await POST(request("creator"));
    expect(response.status).toBe(401);
  });

  it("rate-limits repeated checkout attempts per user", async () => {
    rateLimitFn.mockReturnValue({ ok: false, remaining: 0, resetAt: Date.now() + 60_000 });

    const response = await POST(request("creator"));
    expect(response.status).toBe(429);
    expect(rateLimitFn).toHaveBeenCalledWith("checkout:user_1", 5, 60 * 1000);
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("does not sell the legacy Hobby plan", async () => {
    const response = await POST(request("hobby"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid plan" });
  });

  it("fails clearly when a public Stripe Price is not configured", async () => {
    const response = await POST(request("creator"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "This plan isn't configured yet" });
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("reads a rotated Price id at request time and builds an exact Creator checkout", async () => {
    process.env.STRIPE_PRICE_CREATOR = "price_creator_current";

    const response = await POST(request("creator"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://checkout.stripe.test/session" });
    expect(checkoutCreate).toHaveBeenCalledWith({
      customer: "cus_existing",
      mode: "subscription",
      line_items: [{ price: "price_creator_current", quantity: 1 }],
      success_url: "https://staging.clipforge.test/dashboard/billing?success=1",
      cancel_url: "https://staging.clipforge.test/pricing?canceled=1&plan=creator#plan-creator",
      metadata: { userId: "user_1", plan: "creator" },
      subscription_data: { metadata: { userId: "user_1", plan: "creator" } },
    });
  });

  it("creates and persists a Stripe customer only when the user has none", async () => {
    process.env.STRIPE_PRICE_BUSINESS = "price_business_current";
    userFindUniqueOrThrow.mockResolvedValue({
      id: "user_1",
      email: "creator@example.test",
      stripeCustomerId: null,
    });

    const response = await POST(request("business"));
    expect(response.status).toBe(200);
    expect(customerCreate).toHaveBeenCalledWith({
      email: "creator@example.test",
      metadata: { userId: "user_1" },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { stripeCustomerId: "cus_new" },
    });
    expect(checkoutCreate).toHaveBeenCalledWith(expect.objectContaining({
      customer: "cus_new",
      line_items: [{ price: "price_business_current", quantity: 1 }],
      metadata: { userId: "user_1", plan: "business" },
    }));
  });

  it("returns a user-safe retry message when Stripe is unavailable", async () => {
    process.env.STRIPE_PRICE_CREATOR = "price_creator_current";
    checkoutCreate.mockRejectedValue(new Error("provider internals"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request("creator"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Checkout is temporarily unavailable. Please try again in a moment.",
    });
    errorSpy.mockRestore();
  });
});
