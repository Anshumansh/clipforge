import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("next-auth", () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: (...args: [string]) => redirect(...args) }));
vi.mock("@/components/register-form", () => ({ RegisterForm: () => null }));

const { default: RegisterPage } = await import("./page");

// Same class of bug as app/login/page.test.tsx: an already-logged-in
// visitor has no reason to see a signup form, and staying on it risks
// creating a second, unrelated account by mistake.
describe("RegisterPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects an already-authenticated visitor to /dashboard by default", async () => {
    getServerSession.mockResolvedValue({ user: { id: "user_1" } });
    await expect(RegisterPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("renders the signup form (no redirect) when there is no session", async () => {
    getServerSession.mockResolvedValue(null);
    const result = await RegisterPage({ searchParams: Promise.resolve({}) });
    expect(redirect).not.toHaveBeenCalled();
    expect(result).toBeTruthy();
  });
});
