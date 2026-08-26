import { expect, Page, test } from "@playwright/test";

const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;

type ProjectState = {
  id: string;
  type: string;
  status: string;
  videoUrl: string | null;
  errorMessage: string | null;
  clips: Array<{ id: string; status: string; videoUrl: string | null }>;
  job: { status: string; progress: number; log: string | null } | null;
};

type BrandKitState = {
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  fontFamily: string | null;
  canApply: boolean;
};

async function logIn(page: Page) {
  if (!email || !password) {
    throw new Error("Full acceptance credentials are missing.");
  }

  await page.goto("/login?next=%2Fdashboard");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|[/?#])/, { timeout: 20_000 });
}

async function projectIdFromUrl(page: Page) {
  await expect(page).toHaveURL(/\/dashboard\/projects\/[^/?#]+/, { timeout: 30_000 });
  const match = new URL(page.url()).pathname.match(/\/dashboard\/projects\/([^/]+)/);
  if (!match) throw new Error(`Could not read project id from ${page.url()}`);
  return match[1];
}

async function waitForReadyProject(page: Page, projectId: string): Promise<ProjectState> {
  let latest: ProjectState | null = null;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/projects/${projectId}`);
        expect(response.ok(), `Project ${projectId} status returned HTTP ${response.status()}`).toBe(true);
        latest = (await response.json()) as ProjectState;
        if (latest.status === "failed") {
          throw new Error(
            `Project ${projectId} failed: ${latest.errorMessage ?? latest.job?.log ?? "unknown worker error"}`,
          );
        }
        return latest.status;
      },
      { timeout: 8 * 60 * 1000, intervals: [2_000, 3_000, 5_000, 8_000] },
    )
    .toBe("ready");

  if (!latest) throw new Error(`Project ${projectId} never returned state`);
  return latest;
}

async function assertPlayableDownload(page: Page, url: string) {
  const response = await page.request.get(url, { headers: { Range: "bytes=0-4095" } });
  expect([200, 206]).toContain(response.status());
  expect(response.headers()["content-type"]).toContain("video/mp4");
  expect((await response.body()).byteLength).toBeGreaterThan(1000);
}

async function saveBrandKit(page: Page, state: Partial<BrandKitState>) {
  return page.evaluate(async (next) => {
    const form = new FormData();
    if (next.primaryColor) form.set("primaryColor", next.primaryColor);
    if (next.secondaryColor) form.set("secondaryColor", next.secondaryColor);
    if (next.fontFamily) form.set("fontFamily", next.fontFamily);
    const response = await fetch("/api/brand-kit", { method: "POST", body: form });
    return { status: response.status, body: await response.json() };
  }, state);
}

test.describe("@authenticated @full-acceptance staging Business acceptance", () => {
  test("completes every revenue-critical lifecycle and restores disposable state", async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const createdProjectIds: string[] = [];
    let originalBrandKit: BrandKitState | null = null;
    let createdWorkspace = false;

    await logIn(page);

    try {
      const before = await page.evaluate(async () => {
        const response = await fetch("/api/me", { cache: "no-store" });
        return { status: response.status, body: await response.json() };
      });
      expect(before.status).toBe(200);
      expect(before.body.plan).toBe("business");
      expect(typeof before.body.credits).toBe("number");

      // Brand Kit: persist real values, read them back, and restore the
      // account's original settings in finally so the test is repeatable.
      const brandResponse = await page.request.get("/api/brand-kit");
      expect(brandResponse.status()).toBe(200);
      originalBrandKit = (await brandResponse.json()) as BrandKitState;
      expect(originalBrandKit.canApply).toBe(true);

      const savedBrand = await saveBrandKit(page, {
        primaryColor: "#7c3aed",
        secondaryColor: "#06b6d4",
        fontFamily: "sans",
      });
      expect(savedBrand.status).toBe(200);
      expect(savedBrand.body).toMatchObject({
        primaryColor: "#7c3aed",
        secondaryColor: "#06b6d4",
        fontFamily: "sans",
      });

      // Team/workspace entitlement: create a disposable workspace only when
      // this dedicated account does not already have one, then remove it in
      // finally. Existing owner/member state is preserved untouched.
      const workspaceResponse = await page.request.get("/api/workspace");
      expect(workspaceResponse.status()).toBe(200);
      const workspace = await workspaceResponse.json();
      expect(workspace.canCreate).toBe(true);
      if (workspace.role === null) {
        const createWorkspace = await page.request.post("/api/workspace", {
          data: { name: `Clipforge acceptance ${Date.now()}` },
        });
        expect(createWorkspace.status()).toBe(200);
        createdWorkspace = true;
      } else {
        expect(["owner", "member"]).toContain(workspace.role);
        expect(typeof workspace.workspace?.id).toBe("string");
      }

      // Stripe test mode: prove both a new Business checkout and the existing
      // customer's billing portal can be created. Neither call charges a card.
      for (const endpoint of ["/api/stripe/checkout", "/api/stripe/portal"]) {
        const response = await page.request.post(endpoint, {
          data: endpoint.endsWith("checkout") ? { plan: "business" } : undefined,
        });
        expect(response.status(), `${endpoint} response`).toBe(200);
        const body = await response.json();
        expect(new URL(body.url).hostname).toMatch(/(^|\.)stripe\.com$/);
      }

      // Script-to-video through the real UI, worker, providers, storage, and
      // project page. Preserve the output bytes for the Repurpose upload.
      await page.goto("/dashboard/new/script");
      await page.getByLabel("Topic, script, or article text").fill(
        "A practical three-step method for planning a productive workday without burnout",
      );
      await page.getByRole("button", { name: "Generate video" }).click();
      const scriptProjectId = await projectIdFromUrl(page);
      createdProjectIds.push(scriptProjectId);
      const scriptProject = await waitForReadyProject(page, scriptProjectId);
      expect(scriptProject.type).toBe("script");
      expect(scriptProject.videoUrl).toBeTruthy();
      await assertPlayableDownload(page, scriptProject.videoUrl!);

      for (const format of ["edl", "xml"]) {
        const response = await page.request.get(`/api/projects/${scriptProjectId}/export?format=${format}`);
        expect(response.status(), `${format} export`).toBe(200);
        const body = await response.text();
        if (format === "edl") {
          expect(response.headers()["content-type"]).toContain("text/plain");
          expect(response.headers()["content-disposition"]).toContain(".edl");
          expect(body).toContain("TITLE:");
          expect(body).toContain("FCM:");
        } else {
          expect(response.headers()["content-type"]).toContain("application/xml");
          expect(response.headers()["content-disposition"]).toContain(".xml");
          expect(body).toContain("<?xml");
          expect(body).toContain("<xmeml");
        }
      }

      const sourceVideo = await page.request.get(scriptProject.videoUrl!);
      expect(sourceVideo.status()).toBe(200);
      expect(sourceVideo.headers()["content-type"]).toContain("video/mp4");
      const sourceVideoBytes = await sourceVideo.body();
      expect(sourceVideoBytes.byteLength).toBeGreaterThan(100_000);

      // UGC through the visible product form and the complete render path.
      await page.goto("/dashboard/new/ugc");
      await page.getByLabel("Product name").fill("Clipforge Acceptance Bottle");
      await page.getByLabel("Key selling points").fill(
        "Keeps drinks cold all day\nMade from recycled steel\n30-day money-back guarantee",
      );
      await page.getByLabel("Call to action (optional)").fill("Try it today");
      await page.getByRole("button", { name: "Generate ad video" }).click();
      const ugcProjectId = await projectIdFromUrl(page);
      createdProjectIds.push(ugcProjectId);
      const ugcProject = await waitForReadyProject(page, ugcProjectId);
      expect(ugcProject.type).toBe("ugc");
      expect(ugcProject.videoUrl).toBeTruthy();
      await assertPlayableDownload(page, ugcProject.videoUrl!);

      // Repurpose uses the real Script output as the uploaded source, proving
      // browser metadata parsing, multipart upload, clipping, storage, and
      // clip downloads without adding a synthetic binary fixture to git.
      await page.goto("/dashboard/new/repurpose");
      await page.getByLabel("Video file").setInputFiles({
        name: "clipforge-acceptance-source.mp4",
        mimeType: "video/mp4",
        buffer: sourceVideoBytes,
      });
      await page.getByLabel("What's this video about? (optional, improves clip titles)").fill(
        "Productivity planning advice",
      );
      await page.getByRole("button", { name: "Generate clips" }).click();
      const repurposeProjectId = await projectIdFromUrl(page);
      createdProjectIds.push(repurposeProjectId);
      const repurposeProject = await waitForReadyProject(page, repurposeProjectId);
      expect(repurposeProject.type).toBe("repurpose");
      const readyClips = repurposeProject.clips.filter((clip) => clip.status === "ready" && clip.videoUrl);
      expect(readyClips.length).toBeGreaterThan(0);
      await assertPlayableDownload(page, readyClips[0].videoUrl!);

      const after = await page.evaluate(async () => {
        const response = await fetch("/api/me", { cache: "no-store" });
        return { status: response.status, body: await response.json() };
      });
      expect(after.status).toBe(200);
      // Three distinct, successful operations at 10 credits each. This also
      // catches duplicate charges and missing captures at the user boundary.
      expect(before.body.credits - after.body.credits).toBe(30);
    } finally {
      for (const projectId of createdProjectIds.reverse()) {
        const response = await page.request.delete(`/api/projects/${projectId}`);
        expect([200, 404], `cleanup project ${projectId}`).toContain(response.status());
      }

      if (createdWorkspace) {
        const response = await page.request.delete("/api/workspace");
        expect([200, 404], "workspace cleanup").toContain(response.status());
      }

      if (originalBrandKit) {
        const restored = await saveBrandKit(page, originalBrandKit);
        expect(restored.status, "Brand Kit restoration").toBe(200);
      }
    }
  });
});
