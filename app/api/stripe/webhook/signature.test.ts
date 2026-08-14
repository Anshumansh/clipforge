import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

/**
 * Phase F: app/api/stripe/webhook/route.test.ts mocks stripe.webhooks.constructEvent
 * entirely, so no existing test exercises Stripe's REAL signature verification
 * (HMAC-SHA256 over timestamp + payload, per Stripe's signing scheme) -- a test
 * suite that mocks the thing responsible for rejecting forged webhook calls could
 * pass while that rejection is silently broken.
 *
 * This file uses the real `stripe` package's webhooks.constructEvent /
 * generateTestHeaderString (genuine crypto, no network calls, no real API key
 * needed -- signature verification is entirely local) against the real route
 * handler, with only the DB layer mocked. It proves: a validly-signed real
 * payload is accepted, and a forged/tampered/wrong-secret/expired payload is
 * rejected by Stripe's own verification code, not by a test double standing in
 * for it.
 */

const webhookEventCreate = vi.fn();
type MockDb = {
  stripeWebhookEvent: { create: (...a: unknown[]) => unknown };
  user: { update: (...a: unknown[]) => unknown; findUnique: (...a: unknown[]) => unknown };
  creditLedgerEntry: { create: (...a: unknown[]) => unknown };
  $transaction: (fn: (tx: MockDb) => Promise<unknown>) => Promise<unknown>;
};
const mockDb: MockDb = {
  stripeWebhookEvent: { create: (...a: unknown[]) => webhookEventCreate(...a) },
  user: { update: vi.fn(), findUnique: vi.fn() },
  creditLedgerEntry: { create: vi.fn() },
  $transaction: async (fn) => fn(mockDb),
};
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/pricing/ledger", () => ({ grantCredits: vi.fn() }));
vi.mock("@/lib/plans", () => ({ getPlanByPriceId: () => undefined, getPlanById: () => undefined }));

// Real Stripe client -- no network calls result from constructing it or from
// webhooks.constructEvent/generateTestHeaderString, both are pure local crypto.
const REAL_WEBHOOK_SECRET = "whsec_test_a_real_local_secret_not_sent_anywhere";
process.env.STRIPE_WEBHOOK_SECRET = REAL_WEBHOOK_SECRET;
process.env.STRIPE_SECRET_KEY = "sk_test_dummy_key_never_sent_over_network";

const { POST } = await import("./route");

function signedRequest(payload: string, opts: { secret?: string; timestamp?: number } = {}): Request {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-07-29.dahlia" });
  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: opts.secret ?? REAL_WEBHOOK_SECRET,
    timestamp: opts.timestamp,
  });
  return new Request("https://forgecut.app/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": header },
    body: payload,
  });
}

describe("Stripe webhook signature verification against the REAL stripe SDK crypto (Phase F)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webhookEventCreate.mockResolvedValue({});
  });

  it("accepts a genuinely, correctly signed payload", async () => {
    const payload = JSON.stringify({ id: "evt_real_sig_1", type: "customer.subscription.deleted", data: { object: {} } });
    const res = await POST(signedRequest(payload));

    expect(res.status).toBe(200);
    expect(webhookEventCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: "evt_real_sig_1" }) }));
  });

  it("rejects a payload signed with the WRONG secret (forged webhook attempt)", async () => {
    const payload = JSON.stringify({ id: "evt_forged_1", type: "customer.subscription.deleted", data: { object: {} } });
    const res = await POST(signedRequest(payload, { secret: "whsec_attacker_does_not_know_the_real_secret" }));

    expect(res.status).toBe(400);
    expect(webhookEventCreate).not.toHaveBeenCalled();
  });

  it("rejects a payload whose BODY was tampered with after signing (signature no longer matches)", async () => {
    const originalPayload = JSON.stringify({ id: "evt_tamper_1", type: "customer.subscription.deleted", data: { object: {} } });
    const req = signedRequest(originalPayload);
    // The signature header was computed over originalPayload; swap in a
    // different body afterward, exactly what an attacker intercepting and
    // modifying a request in flight would attempt.
    const tamperedPayload = JSON.stringify({ id: "evt_tamper_1", type: "customer.subscription.deleted", data: { object: { injected: true } } });
    const tamperedReq = new Request(req.url, { method: "POST", headers: req.headers, body: tamperedPayload });

    const res = await POST(tamperedReq);

    expect(res.status).toBe(400);
    expect(webhookEventCreate).not.toHaveBeenCalled();
  });

  it("rejects a signature with a timestamp far enough in the past to be a replay (Stripe's default 5-minute tolerance)", async () => {
    const payload = JSON.stringify({ id: "evt_replay_1", type: "customer.subscription.deleted", data: { object: {} } });
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 10 * 60;
    const res = await POST(signedRequest(payload, { timestamp: tenMinutesAgo }));

    expect(res.status).toBe(400);
    expect(webhookEventCreate).not.toHaveBeenCalled();
  });

  it("rejects a request with no stripe-signature header at all", async () => {
    const payload = JSON.stringify({ id: "evt_no_sig", type: "customer.subscription.deleted", data: { object: {} } });
    const req = new Request("https://forgecut.app/api/stripe/webhook", { method: "POST", body: payload });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(webhookEventCreate).not.toHaveBeenCalled();
  });
});
