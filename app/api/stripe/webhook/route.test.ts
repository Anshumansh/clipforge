import { describe, it, expect, vi, beforeEach } from "vitest";

const constructEvent = vi.fn();
const webhookEventCreate = vi.fn();
const userUpdate = vi.fn();
const userFindUnique = vi.fn();
const subscriptionsRetrieve = vi.fn();

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: (...a: unknown[]) => constructEvent(...a) },
    subscriptions: { retrieve: (...a: unknown[]) => subscriptionsRetrieve(...a) },
  }),
}));

vi.mock("@/lib/plans", () => ({
  getPlanByPriceId: (priceId: string) =>
    priceId === "price_creator" ? { id: "creator", monthlyCredits: 600 } : undefined,
}));

vi.mock("@/lib/db", () => ({
  db: {
    stripeWebhookEvent: { create: (...a: unknown[]) => webhookEventCreate(...a) },
    user: {
      update: (...a: unknown[]) => userUpdate(...a),
      findUnique: (...a: unknown[]) => userFindUnique(...a),
    },
  },
}));

class FakePrismaKnownRequestError extends Error {
  code: string;
  constructor(message: string, opts: { code: string }) {
    super(message);
    this.code = opts.code;
  }
}

vi.mock("@prisma/client", () => ({
  Prisma: { PrismaClientKnownRequestError: FakePrismaKnownRequestError },
}));

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

const { POST } = await import("./route");

function makeRequest(body = "{}"): Request {
  return new Request("https://forgecut.app/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "sig_test" },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/stripe/webhook", () => {
  it("rejects a request with an invalid signature before touching the database", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("signature mismatch");
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(400);
    expect(webhookEventCreate).not.toHaveBeenCalled();
  });

  it("processes a new event and records it for dedup", async () => {
    constructEvent.mockReturnValue({
      id: "evt_1",
      type: "customer.subscription.deleted",
      data: { object: { customer: "cus_1" } },
    });
    webhookEventCreate.mockResolvedValue({});
    userFindUnique.mockResolvedValue({ id: "user-1" });
    userUpdate.mockResolvedValue({});

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ received: true });
    expect(webhookEventCreate).toHaveBeenCalledWith({
      data: { id: "evt_1", type: "customer.subscription.deleted", payloadSummary: expect.any(String) },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { plan: "free", stripeSubscriptionId: null, stripePriceId: null },
    });
  });

  it("is idempotent: a replayed event id is acknowledged without re-running handler logic", async () => {
    constructEvent.mockReturnValue({
      id: "evt_1",
      type: "customer.subscription.deleted",
      data: { object: { customer: "cus_1" } },
    });
    webhookEventCreate.mockRejectedValue(new FakePrismaKnownRequestError("unique violation", { code: "P2002" }));

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ received: true, duplicate: true });
    // The dedup check must short-circuit BEFORE any handler logic touches the user row --
    // otherwise a replayed delivery would still re-apply side effects like a plan downgrade.
    expect(userUpdate).not.toHaveBeenCalled();
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("still processes a second, genuinely different event normally after a duplicate was seen", async () => {
    constructEvent.mockReturnValue({
      id: "evt_2",
      type: "customer.subscription.deleted",
      data: { object: { customer: "cus_1" } },
    });
    webhookEventCreate.mockResolvedValue({});
    userFindUnique.mockResolvedValue({ id: "user-1" });
    userUpdate.mockResolvedValue({});

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });
});
