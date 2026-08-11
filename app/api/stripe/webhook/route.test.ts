import { describe, it, expect, vi, beforeEach } from "vitest";

// ------------------------------------------------------------------
// Mocks
// ------------------------------------------------------------------

const constructEvent = vi.fn();
const webhookEventCreate = vi.fn();
const userUpdate = vi.fn();
const userFindUnique = vi.fn();
const subscriptionsRetrieve = vi.fn();
const ledgerEntryCreate = vi.fn();
const grantCreditsFn = vi.fn();

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: (...a: unknown[]) => constructEvent(...a) },
    subscriptions: { retrieve: (...a: unknown[]) => subscriptionsRetrieve(...a) },
  }),
}));

// All three legacy plans + free, so upgrade-credit tests can compare them.
vi.mock("@/lib/plans", () => ({
  getPlanByPriceId: (priceId: string) => {
    const plans: Record<string, { id: string; monthlyCredits: number }> = {
      price_hobby: { id: "hobby", monthlyCredits: 300 },
      price_creator: { id: "creator", monthlyCredits: 600 },
      price_business: { id: "business", monthlyCredits: 2500 },
    };
    return plans[priceId];
  },
  getPlanById: (id: string) => {
    const plans: Record<string, { id: string; monthlyCredits: number }> = {
      free: { id: "free", monthlyCredits: 0 },
      hobby: { id: "hobby", monthlyCredits: 300 },
      creator: { id: "creator", monthlyCredits: 600 },
      business: { id: "business", monthlyCredits: 2500 },
    };
    return plans[id];
  },
}));

// The webhook route uses db.$transaction in some handlers — the mock passes the
// same mock db object as `tx` so nested tx.user.update still calls userUpdate.
type MockDb = {
  stripeWebhookEvent: { create: (...a: unknown[]) => unknown };
  user: {
    update: (...a: unknown[]) => unknown;
    findUnique: (...a: unknown[]) => unknown;
  };
  creditLedgerEntry: { create: (...a: unknown[]) => unknown };
  $transaction: (fn: (tx: MockDb) => Promise<unknown>) => Promise<unknown>;
};

const mockDb: MockDb = {
  stripeWebhookEvent: { create: (...a: unknown[]) => webhookEventCreate(...a) },
  user: {
    update: (...a: unknown[]) => userUpdate(...a),
    findUnique: (...a: unknown[]) => userFindUnique(...a),
  },
  creditLedgerEntry: { create: (...a: unknown[]) => ledgerEntryCreate(...a) },
  $transaction: async (fn) => fn(mockDb),
};

vi.mock("@/lib/db", () => ({ db: mockDb }));

vi.mock("@/lib/pricing/ledger", () => ({
  grantCredits: (...a: unknown[]) => grantCreditsFn(...a),
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
  grantCreditsFn.mockResolvedValue({ isNew: true });
  ledgerEntryCreate.mockResolvedValue({});
  userUpdate.mockResolvedValue({});
});

// ------------------------------------------------------------------
// Existing dedup and basic event processing tests (unchanged)
// ------------------------------------------------------------------

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
    expect(userUpdate).not.toHaveBeenCalled();
    expect(userFindUnique).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// PAY-001: upgrade credits on customer.subscription.updated
// ------------------------------------------------------------------

describe("customer.subscription.updated — PAY-001 upgrade credits", () => {
  function makeUpgradeEvent(eventId: string, priceId: string, currentPlan: string) {
    constructEvent.mockReturnValue({
      id: eventId,
      type: "customer.subscription.updated",
      data: {
        object: {
          customer: "cus_1",
          items: { data: [{ price: { id: priceId }, current_period_end: 9999999999 }] },
        },
      },
    });
    webhookEventCreate.mockResolvedValue({});
    userFindUnique.mockResolvedValue({ id: "user-1", plan: currentPlan, credits: 200 });
  }

  it("grants the credit difference when upgrading Hobby → Business", async () => {
    makeUpgradeEvent("evt_up1", "price_business", "hobby");

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // credit diff: 2500 (business) - 300 (hobby) = 2200
    expect(grantCreditsFn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        amount: 2200,
        type: "upgrade_grant",
        idempotencyKey: "stripe:upgrade:evt_up1",
      })
    );
  });

  it("grants the credit difference when upgrading Hobby → Creator", async () => {
    makeUpgradeEvent("evt_up2", "price_creator", "hobby");

    await POST(makeRequest());

    // 600 - 300 = 300
    expect(grantCreditsFn).toHaveBeenCalledWith(expect.objectContaining({ amount: 300, type: "upgrade_grant" }));
  });

  it("grants the credit difference when upgrading Creator → Business", async () => {
    makeUpgradeEvent("evt_up3", "price_business", "creator");

    await POST(makeRequest());

    // 2500 - 600 = 1900
    expect(grantCreditsFn).toHaveBeenCalledWith(expect.objectContaining({ amount: 1900 }));
  });

  it("does NOT grant credits on a downgrade (negative diff → clamped to 0)", async () => {
    makeUpgradeEvent("evt_down1", "price_hobby", "business"); // downgrade business → hobby

    await POST(makeRequest());

    // Downgrade: 300 - 2500 = -2200 → clamped to 0 → no grant
    expect(grantCreditsFn).not.toHaveBeenCalled();
  });

  it("does NOT grant credits when the plan ID does not change (same-plan update)", async () => {
    makeUpgradeEvent("evt_same1", "price_creator", "creator"); // same plan

    await POST(makeRequest());

    expect(grantCreditsFn).not.toHaveBeenCalled();
  });

  it("uses a unique idempotency key per event so a duplicate delivery cannot double-grant", async () => {
    // The outer StripeWebhookEvent dedup is the first layer; grantCredits' own
    // idempotencyKey is the second. If both somehow fire, the key must match.
    makeUpgradeEvent("evt_dedup1", "price_business", "hobby");

    await POST(makeRequest());
    expect(grantCreditsFn).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "stripe:upgrade:evt_dedup1" })
    );
  });

  it("handles a user with partially consumed credits: grants the plan diff, not a full replacement", async () => {
    // User upgraded from hobby (300 credits) to business (2500) but had already used 100,
    // leaving 200. The grant adds the DIFFERENCE (2200), not the full 2500.
    constructEvent.mockReturnValue({
      id: "evt_partial",
      type: "customer.subscription.updated",
      data: {
        object: {
          customer: "cus_1",
          items: { data: [{ price: { id: "price_business" }, current_period_end: 9999999999 }] },
        },
      },
    });
    webhookEventCreate.mockResolvedValue({});
    userFindUnique.mockResolvedValue({ id: "user-1", plan: "hobby", credits: 200 }); // 200 remaining

    await POST(makeRequest());

    // User's final balance after the grant: 200 + 2200 = 2400 (not 2500)
    expect(grantCreditsFn).toHaveBeenCalledWith(expect.objectContaining({ amount: 2200 }));
    // grantCredits increments — final balance is whatever grantCredits produces (tested separately)
  });
});

// ------------------------------------------------------------------
// PAY-002: ledger entries written for subscription grants
// ------------------------------------------------------------------

describe("checkout.session.completed — PAY-002 initial grant ledger entry", () => {
  it("writes a CreditLedgerEntry with the plan allocation inside the same transaction", async () => {
    constructEvent.mockReturnValue({
      id: "evt_checkout1",
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { userId: "user-1", plan: "creator" },
          subscription: "sub_1",
        },
      },
    });
    webhookEventCreate.mockResolvedValue({});
    subscriptionsRetrieve.mockResolvedValue({
      id: "sub_1",
      items: { data: [{ price: { id: "price_creator" }, current_period_end: 9999999999 }] },
    });
    userUpdate.mockResolvedValue({});

    await POST(makeRequest());

    expect(ledgerEntryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          type: "monthly_grant",
          delta: 600,
          balanceAfter: 600,
          idempotencyKey: "stripe:initial-grant:evt_checkout1",
        }),
      })
    );
  });
});

describe("invoice.paid (subscription_cycle) — PAY-002 renewal ledger entry", () => {
  it("writes a CreditLedgerEntry with the plan allocation on monthly renewal", async () => {
    constructEvent.mockReturnValue({
      id: "evt_renewal1",
      type: "invoice.paid",
      data: {
        object: {
          customer: "cus_1",
          billing_reason: "subscription_cycle",
          lines: { data: [{ pricing: { price_details: { price: "price_creator" } } }] },
        },
      },
    });
    webhookEventCreate.mockResolvedValue({});
    userFindUnique.mockResolvedValue({ id: "user-1", plan: "creator" });

    await POST(makeRequest());

    expect(ledgerEntryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          type: "monthly_grant",
          delta: 600,
          idempotencyKey: "stripe:renewal:evt_renewal1",
        }),
      })
    );
    // Credits are SET (not incremented) to the plan allocation
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ credits: 600 }) })
    );
  });
});
