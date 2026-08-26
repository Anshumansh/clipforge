import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("next-auth", () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: (...args: [string]) => redirect(...args) }));
vi.mock("@/components/login-form", () => ({ LoginForm: () => null }));

const { default: LoginPage } = await import("./page");

// Regression coverage for a real bug: an already-logged-in visitor landing
// on /login (the public homepage header links here with no way to know a
// visitor is authenticated) saw a blank login form and reasonably assumed
// they'd been signed out, even though the session was never touched.
describe("LoginPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects an already-authenticated visitor to /dashboard by default", async () => {
    getServerSession.mockResolvedValue({ user: { id: "user_1" } });
    await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("redirects to the safe ?next path when one is given", async () => {
    getServerSession.mockResolvedValue({ user: { id: "user_1" } });
    await expect(
      LoginPage({ searchParams: Promise.resolve({ next: "/dashboard/billing" }) })
    ).rejects.toThrow("REDIRECT:/dashboard/billing");
  });

  it("falls back to /dashboard for an unsafe ?next value rather than open-redirecting", async () => {
    getServerSession.mockResolvedValue({ user: { id: "user_1" } });
    await expect(
      LoginPage({ searchParams: Promise.resolve({ next: "https://evil.example" }) })
    ).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("renders the login form (no redirect) when there is no session", async () => {
    getServerSession.mockResolvedValue(null);
    const result = await LoginPage({ searchParams: Promise.resolve({}) });
    expect(redirect).not.toHaveBeenCalled();
    expect(result).toBeTruthy();
  });
});
