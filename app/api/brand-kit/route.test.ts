import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSession = vi.fn();
const userFindUnique = vi.fn();

vi.mock("next-auth", () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
    brandKit: { upsert: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/storage", () => ({ uploadBuffer: vi.fn() }));

const { POST } = await import("./route");

function request(): Request {
  const form = new FormData();
  form.set("primaryColor", "#7c3aed");
  return new Request("https://forgecut.app/api/brand-kit", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: "user_1" } });
});

describe("POST /api/brand-kit", () => {
  it("requires authentication", async () => {
    getServerSession.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
  });

  it("blocks Free and Creator accounts before accepting files", async () => {
    for (const plan of ["free", "creator"]) {
      userFindUnique.mockResolvedValue({ plan });
      const response = await POST(request());
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Brand kit is a Business-plan feature" });
    }
  });
});
