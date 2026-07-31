import react from "@vitejs/plugin-react";
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";

let previewUrl = "";
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

let previewServer: ViteDevServer;

test.describe.configure({ mode: "serial", timeout: 90_000 });

test.beforeAll(async () => {
  previewServer = await createServer({
    appType: "mpa",
    logLevel: "error",
    plugins: [react()],
    resolve: {
      alias: {
        "@": resolve(process.cwd(), "src"),
        "next/image": resolve(process.cwd(), "tests/e2e/nextImageMock.tsx"),
      },
    },
    root: process.cwd(),
    server: {
      host: "127.0.0.1",
      port: 0,
    },
  });
  await previewServer.listen();
  const address = previewServer.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("The persistent player preview server did not expose a TCP port.");
  }
  previewUrl = `http://127.0.0.1:${address.port}/tests/e2e/player-preview.html`;
});

test.afterAll(async () => {
  await previewServer.close();
});

test("keeps the active player clear of content at three viewports", async ({
  page,
}, testInfo) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(previewUrl);

    const bar = page.locator("[data-player-visible='true']");
    const main = page.locator("main");
    await expect(bar).toHaveAttribute("data-state", "loading");
    await expect(page.locator("audio")).toHaveCount(1);
    await expect(page.locator("[data-player-spacer]")).toBeAttached();

    const barBox = await bar.boundingBox();
    const mainBox = await main.boundingBox();
    expect(barBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    expect(Math.abs((barBox?.y ?? 0) + (barBox?.height ?? 0) - viewport.height))
      .toBeLessThanOrEqual(1);
    expect((mainBox?.y ?? 0) + (mainBox?.height ?? 0))
      .toBeLessThanOrEqual((barBox?.y ?? 0) + 1);

    const controls = bar.getByRole("button").filter({ visible: true });
    const controlCount = await controls.count();
    for (let index = 0; index < controlCount; index += 1) {
      const controlBox = await controls.nth(index).boundingBox();
      expect(controlBox?.width).toBeGreaterThanOrEqual(44);
      expect(controlBox?.height).toBeGreaterThanOrEqual(44);
    }

    if (viewport.name === "mobile") {
      await expect(bar.getByRole("group", { name: "音量控制" })).toBeHidden();
      await expect(bar.getByRole("button", { name: /当前顺序播放/ })).toBeHidden();
    } else {
      await expect(bar.getByRole("group", { name: "音量控制" })).toBeVisible();
      await expect(bar.getByRole("button", { name: /当前顺序播放/ })).toBeVisible();
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      path: testInfo.outputPath(`persistent-player-${viewport.name}.png`),
    });
  }
});

test("stays usable at 200 percent equivalent zoom and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto(previewUrl);

  const bar = page.locator("[data-player-visible='true']");
  await expect(bar).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(720);

  const barDuration = await bar.evaluate(
    (element) => getComputedStyle(element).animationDuration,
  );
  const busyAnimation = await page.getByRole("button", {
    name: /播放《Quiet Form》/,
  }).evaluate((element) => {
    const busyRing = element.querySelector<HTMLElement>(":scope > span");
    return busyRing ? getComputedStyle(busyRing).animationName : "missing";
  });
  const durationSeconds = barDuration.endsWith("ms")
    ? Number.parseFloat(barDuration) / 1_000
    : Number.parseFloat(barDuration);
  expect(durationSeconds).toBeLessThanOrEqual(0.001);
  expect(busyAnimation).toBe("none");
});
