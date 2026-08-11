import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// ------------------------------------------------------------------
// Mocks — spies declared before vi.mock factories so the factory
// closures can reference them (Vitest hoists vi.mock to file top).
// ------------------------------------------------------------------

const findUnique = vi.fn();
const create = vi.fn();
const emailVerifCreate = vi.fn();
const rateLimitFn = vi.fn().mockReturnValue({ ok: true });

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      create: (...args: unknown[]) => create(...args),
    },
    emailVerificationToken: {
      create: (...args: unknown[]) => emailVerifCreate(...args),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimitFn(...args),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/email", () => ({
  sendVerificationEmail: vi.fn(),
  isEmailConfigured: vi.fn().mockReturnValue(false), // don't send real emails in tests
}));

// bcryptjs is pure-JS but slow. Stub hash so tests run in < 1ms.
vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("$2a$10$stubhash") },
}));

// Stub NextResponse so we don't need the full Next.js runtime.
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => data,
    }),
  },
}));

const { POST } = await import("@/app/api/register/route");

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function makeRequest(body: unknown) {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Request;
}

function makePrismaP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`email`)",
    { code: "P2002", clientVersion: "5.0.0" }
  );
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("POST /api/register — duplicate-email race condition (AUTH-002)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore defaults that clearAllMocks wiped.
    rateLimitFn.mockReturnValue({ ok: true });
  });

  it("returns 409 when db.user.create throws P2002 (concurrent duplicate insert)", async () => {
    findUnique.mockResolvedValue(null); // sequential check passes (no pre-existing row)
    create.mockRejectedValue(makePrismaP2002()); // concurrent race loses the insert

    const res = await POST(
      makeRequest({ name: "Alice", email: "alice@example.com", password: "password123" })
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/i);
  });

  it("returns the same 409 message as the sequential duplicate check (no information leakage)", async () => {
    // Race-condition path: findUnique returned null, then create throws P2002.
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(makePrismaP2002());
    const raceRes = await POST(
      makeRequest({ name: "Bob", email: "bob@example.com", password: "password123" })
    );
    const raceBody = await raceRes.json();

    // Sequential-duplicate path: findUnique finds an existing user.
    findUnique.mockResolvedValue({ id: "existing-id", email: "bob@example.com" });
    const seqRes = await POST(
      makeRequest({ name: "Bob", email: "bob@example.com", password: "password123" })
    );
    const seqBody = await seqRes.json();

    expect(raceRes.status).toBe(409);
    expect(seqRes.status).toBe(409);
    expect(raceBody.error).toBe(seqBody.error);
  });

  it("re-throws non-P2002 errors so they surface as unhandled 500", async () => {
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(new Error("Database connection lost"));

    await expect(
      POST(makeRequest({ name: "Carol", email: "carol@example.com", password: "password123" }))
    ).rejects.toThrow("Database connection lost");
  });
});
