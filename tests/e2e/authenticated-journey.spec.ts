import { expect, Page, test } from "@playwright/test";

const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;

async function logIn(page: Page) {
  if (!email || !password) {
    throw new Error(
      "Authenticated E2E credentials are missing. Add E2E_TEST_EMAIL and E2E_TEST_PASSWORD as GitHub Actions secrets.",
    );
  }

  await page.goto("/login?next=%2Fdashboard");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();

  // This must remain a dedicated, staging-only account without MFA. CI must
  // never receive or store an authenticator seed or backup code.
  if (await page.getByLabel("Authenticator code").isVisible().catch(() => false)) {
    throw new Error("Dedicated E2E account must not require MFA.");
  }

  await expect(page).toHaveURL(/\/dashboard(?:$|[/?#])/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Your video workspace" })).toBeVisible();
}

test.describe("@authenticated staging Business journey", () => {
  test("keeps the session, exposes every core feature, and supports logout and re-login", async ({ page, context }) => {
    test.setTimeout(3 * 60 * 1000);
    await logIn(page);

    const account = await page.evaluate(async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      return { status: response.status, body: await response.json() };
    });
    expect(account.status).toBe(200);
    expect(account.body.plan).toBe("business");
    expect(typeof account.body.credits).toBe("number");

    // Full navigations, not only client-side clicks, deliberately stress the
    // session cookie on every authenticated page that appears in navigation.
    const authenticatedPages: Array<[string, string]> = [
      ["/dashboard", "Your video workspace"],
      ["/dashboard/create", "What do you want to create?"],
      ["/dashboard/ideas", "Discover ideas"],
      ["/dashboard/trends", "Discover trends"],
      ["/dashboard/schedule", "Schedule"],
      ["/dashboard/settings", "Settings"],
      ["/dashboard/settings/brand", "Brand kit"],
      ["/dashboard/settings/team", "Team"],
      ["/dashboard/settings/api-keys", "API keys"],
      ["/dashboard/billing", "Billing"],
    ];

    for (const [path, heading] of authenticatedPages) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}(?:$|[?#])`));
      // Some pages repeat the page name in a card heading. Target the single
      // document h1 so a valid duplicate h3 does not create a false failure.
      await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    }

    await page.goto("/dashboard");
    const primaryNav = page.locator("aside nav");
    await expect(primaryNav.getByRole("link")).toHaveCount(5);
    for (const label of ["Home", "Create video", "Discover", "Publish", "Settings"]) {
      await expect(primaryNav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    // The simplified creation hub must lead to all three real generators.
    await page.goto("/dashboard/create");
    await expect(page.getByRole("link", { name: /Start with an idea or script/ })).toHaveAttribute("href", "/dashboard/new/script");
    await expect(page.getByRole("link", { name: /Start with a long video/ })).toHaveAttribute("href", "/dashboard/new/repurpose");
    await expect(page.getByRole("link", { name: /Create a product ad/ })).toHaveAttribute("href", "/dashboard/new/ugc");

    // Verify every essential generator control without submitting or spending
    // credits. Optional controls must be discoverable but collapsed by default.
    await page.goto("/dashboard/new/script");
    await expect(page.getByLabel("Topic, script, or article text")).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate video" })).toBeVisible();
    const scriptOptions = page.locator("summary", { hasText: "Customize video (optional)" });
    await expect(scriptOptions).toBeVisible();
    await expect(scriptOptions.locator("xpath=..")).not.toHaveAttribute("open", "");
    await scriptOptions.click();
    await expect(page.getByRole("button", { name: /1:1/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /16:9/ })).toBeEnabled();
    await expect(page.getByLabel("Clone your voice (optional)")).toBeEnabled();

    await page.goto("/dashboard/new/repurpose");
    await expect(page.getByLabel("Video file")).toBeAttached();
    await expect(page.getByRole("button", { name: "Generate clips" })).toBeVisible();
    await expect(page.locator("summary", { hasText: "Customize clip format (optional)" })).toBeVisible();

    await page.goto("/dashboard/new/ugc");
    await expect(page.getByLabel("Product name")).toBeVisible();
    await expect(page.getByLabel("Key selling points")).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate ad video" })).toBeVisible();
    await expect(page.locator("summary", { hasText: "Customize ad format (optional)" })).toBeVisible();

    // Idea discovery is a real provider-backed feature, not a static card.
    // Run it once and prove a returned idea can enter the creation flow.
    await page.goto("/dashboard/ideas");
    await page.getByLabel("Niche").fill("healthy meal preparation");
    await page.getByRole("button", { name: "Generate ideas" }).click();
    const useIdeaButton = page.getByRole("button", { name: "Use this idea" }).first();
    await expect(useIdeaButton).toBeVisible({ timeout: 45_000 });
    await useIdeaButton.click();
    await expect(page).toHaveURL(/\/dashboard\/new\/script\?topic=/);
    await expect(page.getByLabel("Topic, script, or article text")).not.toHaveValue("");

    // Settings is a real hub: every advanced feature must have one clear,
    // navigable entry point rather than dashboard text that cannot be used.
    await page.goto("/dashboard/settings");
    const settingsLinks: Array<[string, string]> = [
      ["Brand kit", "/dashboard/settings/brand"],
      ["Team", "/dashboard/settings/team"],
      ["Plan and billing", "/dashboard/billing"],
      ["API access", "/dashboard/settings/api-keys"],
    ];
    for (const [name, href] of settingsLinks) {
      await expect(page.getByRole("link", { name: new RegExp(name, "i") })).toHaveAttribute("href", href);
    }

    // Exercise a complete API-key lifecycle against the dedicated staging
    // account and remove the disposable record before continuing.
    const apiKeyLifecycle = await page.evaluate(async () => {
      const create = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: `E2E disposable ${Date.now()}` }),
      });
      const created = await create.json();
      if (!create.ok) return { createStatus: create.status, deleteStatus: null, rawShape: false };
      const remove = await fetch(`/api/api-keys/${created.id}`, { method: "DELETE" });
      return {
        createStatus: create.status,
        deleteStatus: remove.status,
        rawShape: typeof created.raw === "string" && created.raw.startsWith("cf_live_"),
      };
    });
    expect(apiKeyLifecycle).toEqual({ createStatus: 200, deleteStatus: 200, rawShape: true });

    // Starting checkout is non-destructive but proves the live staging
    // Stripe secret and Business Price are configured and accepted.
    const checkout = await page.evaluate(async () => {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "business" }),
      });
      const body = await response.json();
      return { status: response.status, url: body.url as unknown };
    });
    expect(checkout.status).toBe(200);
    expect(typeof checkout.url).toBe("string");
    expect(new URL(checkout.url as string).hostname).toMatch(/(^|\.)stripe\.com$/);

    // Verify entitlement display and session sharing across a new tab.
    await page.goto("/dashboard/billing");
    // The Business badge is nested inside this heading, so its accessible
    // name is "Current plan Business" rather than two independent labels.
    await expect(page.getByRole("heading", { name: /Current plan Business/i })).toBeVisible();
    await expect(page.getByText("Business", { exact: true })).toBeVisible();

    const secondTab = await context.newPage();
    await secondTab.goto("/dashboard/settings/api-keys");
    await expect(secondTab.getByRole("heading", { level: 1, name: "API keys" })).toBeVisible();
    await secondTab.close();

    // Finally prove the complete session lifecycle, including an explicit
    // logout followed by a clean login with the same dedicated account.
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
    await logIn(page);
  });
});
