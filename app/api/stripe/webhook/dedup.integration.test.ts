import { describe, it, expect, afterEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { PostgresTestDB, ConcurrencyBarrier } from "@/lib/testing/postgres-integration";

/**
 * Phase F: proves exactly-once webhook processing under REAL concurrent
 * delivery against REAL Postgres -- app/api/stripe/webhook/route.test.ts's
 * "is idempotent" test only proves the mocked db.stripeWebhookEvent.create
 * throws a fake P2002 on a SECOND, sequential call; it says nothing about
 * whether StripeWebhookEvent.id's unique constraint actually serializes two
 * TRULY concurrent deliveries of the same event (the actual scenario Stripe's
 * "at-least-once, so handle retries idempotently" webhook guarantee exists
 * for -- a slow handler plus Stripe's own retry-on-timeout can result in two
 * deliveries of the same event arriving close enough together to race).
 */
let activeDb: PrismaClient;
vi.mock("@/lib/db", () => ({
  get db() {
    return activeDb;
  },
}));
vi.mock("@/lib/pricing/ledger", () => ({ grantCredits: vi.fn() }));
vi.mock("@/lib/plans", () => ({ getPlanByPriceId: () => undefined, getPlanById: () => undefined }));

const WEBHOOK_SECRET = "whsec_dedup_integration_test_secret";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.STRIPE_SECRET_KEY = "sk_test_dummy_key_never_sent_over_network";

const { POST } = await import("@/app/api/stripe/webhook/route");

function signedRequest(payload: string): Request {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-07-29.dahlia" });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return new Request("https://forgecut.app/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": header },
    body: payload,
  });
}

describe("Stripe webhook exactly-once dedup under real concurrent delivery against real Postgres (Phase F)", () => {
  let pgTestDb: PostgresTestDB | null = null;

  afterEach(async () => {
    await pgTestDb?.cleanup();
    pgTestDb = null;
  });

  it("N truly concurrent deliveries of the SAME event id: exactly one is recorded, the rest get duplicate:true, none throw unhandled", async () => {
    pgTestDb = await PostgresTestDB.create();
    activeDb = pgTestDb.createClient();

    const DELIVERY_COUNT = 8;
    // payment_intent.succeeded isn't handled by any switch case (falls to
    // default: break) -- isolates the dedup mechanism itself from every
    // other handler's side effects, which aren't what this test is about.
    const payload = JSON.stringify({ id: "evt_concurrent_delivery_1", type: "payment_intent.succeeded", data: { object: {} } });

    const barrier = new ConcurrencyBarrier(DELIVERY_COUNT);
    const responses = await Promise.all(
      Array.from({ length: DELIVERY_COUNT }, async () => {
        await barrier.wait();
        return POST(signedRequest(payload));
      })
    );

    expect(responses.every((r) => r.status === 200)).toBe(true);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    const duplicateCount = bodies.filter((b) => b.duplicate === true).length;
    const freshCount = bodies.filter((b) => b.duplicate !== true).length;

    expect(freshCount).toBe(1);
    expect(duplicateCount).toBe(DELIVERY_COUNT - 1);

    // The database must agree: exactly one row for this event id.
    const rows = await activeDb.stripeWebhookEvent.findMany({ where: { id: "evt_concurrent_delivery_1" } });
    expect(rows).toHaveLength(1);
  });
});
