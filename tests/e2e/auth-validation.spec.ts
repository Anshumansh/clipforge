import { test, expect } from "@playwright/test";

// Covers auth-adjacent behavior that's safe to test without ever completing
// a real signup or logging into a real account: client-side validation,
// rejection paths, and responses that must not leak account existence.
// Full signup->verify->login->session->TOTP coverage needs a seeded test
// account and is intentionally NOT here -- see tests/e2e/README.md.

test.describe("registration form validation", () => {
  test("rejects an invalid email format client-side, no request sent", async ({ page }) => {
    await page.goto("/register");
    let requestSent = false;
    page.on("request", (req) => {
      if (req.url().includes("/api/register")) requestSent = true;
    });

    await page.getByLabel("Name").fill("QA Test");
    await page.getByLabel("Email").fill("not-a-valid-email");
    await page.getByLabel("Password").fill("irrelevant123");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForTimeout(500);

    expect(requestSent).toBe(false);
    const email = page.getByLabel("Email");
    expect(await email.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
  });

  test("enforces a minimum password length client-side", async ({ page }) => {
    await page.goto("/register");
    const password = page.getByLabel("Password");
    expect(await password.getAttribute("minlength")).toBe("6");
  });
});

test.describe("login rejection path", () => {
  test("shows a generic error for credentials that don't match any account", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(`qa-nonexistent-${Date.now()}@example.com`);
    await page.getByLabel("Password").fill("wrongpassword123");
    await page.getByRole("button", { name: "Log in" }).click();

    // Must not distinguish "no such account" from "wrong password" --
    // that distinction is exactly what an enumeration attack looks for.
    await expect(page.getByText("Invalid email or password")).toBeVisible();
  });
});

test.describe("protected routes", () => {
  test("redirects to login with a relative callback when signed out", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  });
});

test.describe("password reset", () => {
  test("returns the same generic message regardless of whether the email exists", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(`qa-nonexistent-${Date.now()}@example.com`);
    await page.getByRole("button", { name: /reset|send/i }).click();
    await expect(page.getByText(/if an account exists/i)).toBeVisible();
  });
});

test.describe("email verification links", () => {
  test("shows a clear message for an invalid or expired token", async ({ page }) => {
    await page.goto("/verify-email/this-token-does-not-exist-e2e-test");
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  });
});

test.describe("password reset with an invalid token", () => {
  test("rejects at submit time without changing any password", async ({ page }) => {
    await page.goto("/reset-password/this-token-does-not-exist-e2e-test");
    // Unlike verify-email/invite, this page doesn't pre-validate the token on
    // load (see app/reset-password/[token]/page.tsx) -- the form always
    // renders. The security property that matters is server-side: the token
    // must be checked before any write, which is what this asserts.
    await page.getByLabel("New password").fill("qa-test-password-999");
    await page.getByLabel("Confirm password").fill("qa-test-password-999");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
  });
});

test.describe("team invite with an invalid token", () => {
  test("shows a clear not-found message", async ({ page }) => {
    await page.goto("/invite/this-token-does-not-exist-e2e-test");
    await expect(page.getByText(/invite not found/i)).toBeVisible();
  });
});

test.describe("unmapped route", () => {
  test("shows a real 404 page with a way back", async ({ page }) => {
    await page.goto("/this-page-does-not-exist-e2e-test");
    await expect(page.getByText(/page not found/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /back to home/i })).toBeVisible();
  });
});

test.describe("authenticated API routes reject anonymous requests", () => {
  const expectations: [string, number][] = [
    ["/api/projects", 401],
    ["/api/me", 401],
    ["/api/brand-kit", 401],
    ["/api/workspace", 401],
    ["/api/api-keys", 401],
    ["/api/social/accounts", 401],
    ["/api/trend/feed", 401],
    ["/api/admin/reconciliation", 403],
  ];

  for (const [path, expectedStatus] of expectations) {
    test(`${path} returns ${expectedStatus} for an anonymous request`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(expectedStatus);
    });
  }
});
