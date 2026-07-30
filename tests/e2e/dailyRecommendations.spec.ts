import { expect, test, type Page } from "@playwright/test";

const track = {
  id: "101",
  name: "Synthetic Signal",
  artists: [{ id: "201", name: "Synthetic Artist", avatarUrl: null }],
  album: { id: "301", name: "Synthetic Album", artworkUrl: null },
  durationMs: 180_000,
  artworkUrl: null,
  aliases: [],
  explicit: false,
  availability: "unknown",
  privilege: { fee: 0, maxQuality: null },
};

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

function apiSuccess(data: unknown, mode: "real" | "demo" = "real") {
  return { ok: true, data, meta: { requestId: "daily-e2e", mode } };
}

function apiFailure(code: string) {
  return {
    ok: false,
    error: {
      code,
      message: "Synthetic upstream failure",
      retryable: true,
      requestId: "daily-e2e",
    },
  };
}

async function installDailyRoutes(
  page: Page,
  options: { delayFirstDaily?: boolean; initialFailure?: boolean } = {},
) {
  let mode: "real" | "demo" = "real";
  let firstDaily = true;
  let releaseFirstDaily: (() => void) | null = null;
  let markFirstDailyReady: (() => void) | null = null;
  const firstDailyReady = new Promise<void>((resolve) => {
    markFirstDailyReady = resolve;
  });

  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(apiSuccess({ mode, user: null }, mode)),
    });
  });
  await page.route("**/api/recommendations/daily", async (route) => {
    if (options.delayFirstDaily && firstDaily) {
      firstDaily = false;
      await new Promise<void>((resolve) => {
        releaseFirstDaily = resolve;
        markFirstDailyReady?.();
      });
    }
    if (mode === "demo") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(apiSuccess({
          date: "2026-07-30",
          source: "demo",
          tracks: [track],
        }, "demo")),
      });
      return;
    }
    if (options.initialFailure) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify(apiFailure("UPSTREAM_UNAVAILABLE")),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(apiSuccess({
        date: "2026-07-30",
        source: "public",
        tracks: [track],
      })),
    });
  });
  await page.route("**/api/mode", async (route) => {
    const input = route.request().postDataJSON() as { mode: "real" | "demo" };
    mode = input.mode;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(apiSuccess({ mode, user: null }, mode)),
    });
  });

  return {
    async waitForFirstDaily() {
      await firstDailyReady;
    },
    releaseFirstDaily() {
      releaseFirstDaily?.();
    },
  };
}

test.describe.configure({ mode: "serial" });

test("keeps the homepage canvas stable while daily recommendation states load at three viewports", async ({ page }, testInfo) => {
  const routes = await installDailyRoutes(page, { delayFirstDaily: true });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const canvas = page.getByLabel("Interactive project gallery");
    await expect(canvas).toBeVisible();
    await expect.poll(async () => canvas.evaluate((element) => {
      const { height, width } = element.getBoundingClientRect();
      return { height, width };
    })).toEqual({ height: viewport.height, width: viewport.width });

    if (viewport.name === "desktop") {
      const loading = page.getByRole("status");
      await expect(loading).toContainText("正在载入今日推荐");
      await routes.waitForFirstDaily();
      routes.releaseFirstDaily();
    }
    const publicStatus = page.locator('[data-state="public"]');
    await expect(publicStatus).toBeVisible();
    await expect(publicStatus).toContainText("PUBLIC SELECTION");
    await expect(page.getByRole("button", { name: "扫码查看你的日推" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`daily-${viewport.name}.png`) });
  }
});

test("keeps a 503 failure in Real mode until the user explicitly enters Demo", async ({ page }) => {
  await installDailyRoutes(page, { initialFailure: true });
  await page.setViewportSize(viewports[0]);
  await page.goto("/");

  const failure = page.locator('[data-state="error"]');
  await expect(failure).toContainText("无法载入今日推荐");
  const demoAction = page.getByRole("button", { name: "使用演示数据" });
  expect(await demoAction.count()).toBe(1);
  await demoAction.click();

  const demoStatus = page.locator('[data-state="demo"]');
  await expect(demoStatus).toBeVisible();
  await expect(demoStatus).toContainText("未混入你的实时推荐");
  const realAction = page.getByRole("button", { name: "返回实时数据" });
  expect(await realAction.count()).toBe(1);
  await realAction.click();
  await expect(page.locator('[data-state="error"]')).toContainText("无法载入今日推荐");
});
