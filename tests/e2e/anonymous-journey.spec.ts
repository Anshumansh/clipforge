import { test, expect } from "@playwright/test";

// Covers the parts of the customer journey reachable with no account:
// homepage -> pricing -> anonymous demo generation -> playback, plus the
// homepage showcase previews. These are the two bugs confirmed and fixed
// in this same recovery pass (see app/page.tsx, docker-compose.yml), so
// this suite is also the regression guard against them recurring.

test.describe("homepage", () => {
  test("loads with no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /scroll-stopping short/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("all three showcase preview clips play with real content", async ({ page }) => {
    await page.goto("/");

    // Deliberately NOT switching to "See examples" mode: HeroShowcase's own
    // mode-switcher pills (components/hero-showcase.tsx) use the identical
    // `Preview: ${label}` aria-label convention as the always-visible
    // ClipTile grid (components/hero-demo.tsx) this test targets, so both
    // would match and Playwright's strict mode correctly refuses to guess
    // which one. The ClipTile grid renders regardless of mode, so this
    // works without switching modes at all.
    const grid = page.locator("text=Real output — tap or hover to preview:").locator("..");

    const tiles = [
      "Preview: Script to video",
      "Preview: Repurpose — auto face tracking",
      "Preview: UGC-style ad",
    ];

    for (const label of tiles) {
      const tile = grid.getByRole("button", { name: label });
      const [response] = await Promise.all([
        page.waitForResponse((r) => /\/api\/showcase\/(script|repurpose|ugc)$/.test(new URL(r.url()).pathname), { timeout: 15000 }).catch(() => null),
        tile.click(),
      ]);
      // The browser deliberately stays on a stable first-party endpoint.
      // Cached HTML never contains an expiring storage signature and direct
      // provider behaviour cannot vary by browser or CI runner.
      expect(response, `${label} produced no video request`).not.toBeNull();
      expect(response!.status(), `${label} video request`).toBeLessThan(400);
      expect(response!.headers()["content-type"]).toContain("video/mp4");

      // A successful network response isn't proof the clip actually plays --
      // the browser cache can serve a stale/empty response as a 200, and a
      // corrupt or undecodable file still "resolves" as a request. Check the
      // real <video> element's own state instead, the same signal a viewer's
      // browser relies on.
      const video = tile.locator("video");
      const handle = await video.elementHandle();
      if (!handle) throw new Error(`${label}: <video> element never mounted after click`);

      await page.waitForFunction((el) => (el as HTMLVideoElement).readyState >= 1, handle, { timeout: 15000 });

      const state = await handle.evaluate((el) => {
        const v = el as HTMLVideoElement;
        return {
          currentSrc: v.currentSrc,
          readyState: v.readyState,
          duration: v.duration,
          error: v.error ? `${v.error.code}: ${v.error.message}` : null,
        };
      });
      expect(state.currentSrc, `${label} currentSrc`).not.toBe("");
      expect(state.readyState, `${label} readyState`).toBeGreaterThanOrEqual(1);
      expect(state.duration, `${label} duration`).toBeGreaterThan(0);
      expect(state.error, `${label} video.error`).toBeNull();

      // muted autoplay should already be underway from the click (see
      // ClipTile's loadThenPlay in components/hero-demo.tsx) -- confirm
      // currentTime actually advances rather than trusting `paused` alone.
      // Polls instead of a single fixed wait: headless Firefox/WebKit in CI
      // can take noticeably longer than Chromium to actually begin
      // decoding/playing a muted video after .play() resolves, and a tight
      // one-shot window was flaking on exactly those two browsers even
      // though the video had already loaded correctly (readyState/duration/
      // error all fine) -- this isn't a real product defect, just CI
      // startup variance across engines.
      const t0 = await handle.evaluate((el) => (el as HTMLVideoElement).currentTime);
      await expect
        .poll(async () => handle.evaluate((el) => (el as HTMLVideoElement).currentTime), {
          message: `${label} currentTime did not advance -- playback never actually started`,
          timeout: 8000,
        })
        .toBeGreaterThan(t0);

      await handle.evaluate((el) => (el as HTMLVideoElement).pause());
    }
  });
});

test.describe("anonymous demo generation", () => {
  test("submits, renders, and plays back a real video", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try it free — no signup" }).click();

    await page.getByPlaceholder(/morning habits/i).fill(
      "Three simple stretches you can do at your desk to ease back pain"
    );
    await page.getByRole("button", { name: /generate my clip/i }).click();

    // The submit route holds a transaction-scoped advisory lock across the
    // active-job count-then-insert (app/api/demo/generate/route.ts) to
    // close a check-then-act race -- back-to-back demo submissions
    // (e.g. this test running right after another) can genuinely queue
    // behind that lock for a few seconds longer than a single isolated
    // request would take. 10s occasionally wasn't enough despite the
    // submission succeeding server-side; 30s gives real headroom.
    await expect(page.getByText(/queued|generating your video/i)).toBeVisible({ timeout: 30000 });

    // Real render, not mocked -- give it the full couple of minutes the UI
    // itself says to expect, matching the observed ~90s render time.
    const video = page.locator("video[autoplay]");
    await expect(video).toBeVisible({ timeout: 3 * 60 * 1000 });

    // `src` being set (autoplay attribute present) doesn't mean metadata has
    // loaded yet -- checking .duration immediately after visibility is a
    // real race (observed: NaN). Poll until readyState confirms metadata
    // (including duration) is actually available.
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15000 })
      .toBeGreaterThanOrEqual(1);

    const duration = await video.evaluate((v: HTMLVideoElement) => v.duration);
    expect(Number.isNaN(duration)).toBe(false);
    expect(duration).toBeGreaterThan(0);

    const error = await video.evaluate((v: HTMLVideoElement) => v.error);
    expect(error).toBeNull();
  });

  test("rejects a too-short topic without hitting the server", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try it free — no signup" }).click();

    const submit = page.getByRole("button", { name: /generate my clip/i });
    await page.getByPlaceholder(/morning habits/i).fill("short");
    // minLength=10 client-side -- the button's disabled state itself is the
    // assertion (matches hero-demo.tsx: disabled={... || topic.trim().length < 10}).
    await expect(submit).toBeDisabled();
  });
});

test.describe("pricing page", () => {
  test("displays all three plans with working signup CTAs", async ({ page }) => {
    await page.goto("/pricing");
    for (const plan of ["Free", "Hobby", "Creator", "Business"]) {
      // Plan cards use Framer Motion scroll-reveal (components/reveal.tsx) --
      // genuinely opacity:0 until scrolled into view (grid layout varies by
      // viewport width, so scroll each into view individually rather than
      // assuming one scroll reveals the whole row).
      //
      // Not `exact: true`: the Creator card's "Popular" badge sits inside
      // the same heading with no whitespace between them in the markup, so
      // its accessible name computes to the single run-on word
      // "CreatorPopular" rather than "Creator" -- a real (if minor) a11y
      // polish gap worth its own fix separately, but this test's job is
      // checking the plan renders, not re-litigating that markup choice.
      const el = page.getByText(plan).first();
      await el.scrollIntoViewIfNeeded();
      await expect(el).toBeVisible();
    }
    // Regression guard: prices must keep matching Stripe's actual
    // configuration (verified manually against the live Price objects
    // during this recovery pass). A hardcoded expectation here is
    // deliberate -- a drift between this and Stripe should fail loudly,
    // not be silently accepted by re-reading whatever's on the page.
    await expect(page.getByText("$19.99/mo")).toBeVisible();
    await expect(page.getByText("$26.88/mo")).toBeVisible();
    await expect(page.getByText("$44.99/mo")).toBeVisible();
  });
});

test.describe("public route inventory", () => {
  const routes = [
    "/",
    "/pricing",
    "/login",
    "/register",
    "/how-it-works",
    "/for/podcasters",
    "/for/ecommerce",
    "/for/agencies",
    "/vs/opus-clip",
    "/vs/revid-ai",
    "/changelog",
    "/roadmap",
    "/trust",
    "/privacy",
    "/terms",
    "/contact",
    "/forgot-password",
  ];

  for (const route of routes) {
    test(`${route} returns 200 with no console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      const res = await page.goto(route);
      expect(res?.status()).toBe(200);
      expect(errors).toEqual([]);
    });
  }
});
