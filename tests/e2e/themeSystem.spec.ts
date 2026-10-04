import { expect, test, type Page } from "@playwright/test";

import type { Track } from "../../src/lib/music/models";
import { contrastRatio } from "../../src/lib/theme/artworkPalette";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const tracks: Track[] = [
  { id: "theme-one", name: "Scarlet Signal", artworkUrl: "/theme-one.png" },
  { id: "theme-two", name: "Verdant Signal", artworkUrl: "/theme-two.png" },
].map((track) => ({
  ...track,
  artists: [{ id: "theme-artist", name: "Theme Artist", avatarUrl: null }],
  album: { id: "theme-album", name: "Theme Album", artworkUrl: track.artworkUrl },
  durationMs: 180_000,
  aliases: [],
  explicit: false,
  availability: "playable" as const,
  privilege: { fee: 0, maxQuality: null },
}));

function success(data: unknown): string {
  return JSON.stringify({ ok: true, data });
}

async function coverPng(page: Page, color: string): Promise<Buffer> {
  const dataUrl = await page.evaluate((fill) => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas is unavailable.");
    context.fillStyle = fill;
    context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL("image/png");
  }, color);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

async function installRoutes(page: Page, options: {
  authenticated?: boolean;
  dailyFailure?: boolean;
  secondCover?: "normal" | "delayed" | "failed";
} = {}) {
  const red = await coverPng(page, "#e72a49");
  const green = await coverPng(page, "#159b5d");
  let releaseSecond: (() => void) | null = null;
  let markSecondRequested: (() => void) | null = null;
  const secondRequested = new Promise<void>((resolve) => { markSecondRequested = resolve; });

  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/auth/session") {
      await route.fulfill({ contentType: "application/json", body: success({
        mode: "real",
        user: options.authenticated === false ? null
          : { id: "theme-user", nickname: "Theme Listener", avatarUrl: null, signature: null },
      }) });
      return;
    }
    if (pathname === "/api/recommendations/daily") {
      await route.fulfill(options.dailyFailure
        ? { status: 503, contentType: "application/json", body: JSON.stringify({
          ok: false,
          error: { code: "UPSTREAM_UNAVAILABLE", message: "Synthetic failure", retryable: true },
        }) }
        : { contentType: "application/json", body: success({
          date: "2026-10-04", source: "personal", tracks,
        }) });
      return;
    }
    if (pathname.startsWith("/api/tracks/")) {
      if (pathname.endsWith("/lyrics")) {
        await route.fulfill({ contentType: "application/json", body: success({ kind: "none", lines: [] }) });
      } else if (pathname.endsWith("/comments")) {
        await route.fulfill({ contentType: "application/json", body: success({
          items: [], total: 0, hasMore: false, limit: 10, offset: 0,
        }) });
      } else {
        const id = pathname.split("/")[3];
        await route.fulfill({ contentType: "application/json", body: success(
          tracks.find((track) => track.id === id) ?? tracks[0],
        ) });
      }
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/theme-one.png", (route) => route.fulfill({ body: red, contentType: "image/png" }));
  await page.route("**/theme-two.png", async (route) => {
    if (options.secondCover === "delayed") {
      markSecondRequested?.();
      await new Promise<void>((resolve) => { releaseSecond = resolve; });
    }
    if (options.secondCover === "failed") {
      await route.abort();
      return;
    }
    await route.fulfill({ body: green, contentType: "image/png" });
  });

  return { releaseSecond: async () => {
    await secondRequested;
    releaseSecond?.();
  } };
}

async function chooseTheme(page: Page, label: string): Promise<void> {
  if (!await page.getByRole("dialog", { name: "显示主题" }).isVisible()) {
    await page.getByRole("button", { name: "显示主题" }).click();
  }
  await page.getByRole("button", { name: label }).click();
}

async function screenshotPixel(page: Page, screenshot: Buffer, x: number, y: number) {
  return page.evaluate(async ({ image, x, y }) => {
    const bitmap = new Image();
    bitmap.src = `data:image/png;base64,${image}`;
    await bitmap.decode();
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Screenshot decoder is unavailable.");
    context.drawImage(bitmap, 0, 0);
    return [...context.getImageData(x, y, 1, 1).data].slice(0, 3);
  }, { image: screenshot.toString("base64"), x, y });
}

function rgb(value: string) {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unexpected CSS color: ${value}`);
  return { r: channels[0], g: channels[1], b: channels[2] };
}

async function expectReadableTheme(page: Page, kind: "ink" | "paper") {
  await expect(page.locator("html")).toHaveAttribute("data-theme", kind);
  const colors = await page.evaluate(() => {
    const body = window.getComputedStyle(document.body);
    const focusProbe = document.createElement("span");
    focusProbe.style.color = "var(--ef-focus-ring)";
    document.body.append(focusProbe);
    const focus = window.getComputedStyle(focusProbe).color;
    focusProbe.remove();
    return { background: body.backgroundColor, foreground: body.color, focus };
  });
  expect(contrastRatio(rgb(colors.foreground), rgb(colors.background))).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(rgb(colors.focus), rgb(colors.background))).toBeGreaterThanOrEqual(3);
}

test("applies ARTWORK across home, preview, and track page at three viewports", async ({ page }, testInfo) => {
  await installRoutes(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const canvas = page.getByLabel("Interactive daily track gallery");
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute("data-artwork-loaded-count", "2");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "artwork");
    const surface = await page.locator("html").evaluate((element) =>
      element.style.getPropertyValue("--ef-artwork-surface"));
    expect(surface).toMatch(/^#[0-9a-f]{6}$/);
    await expect.poll(async () => canvas.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return [rect.width, rect.height];
    })).toEqual([viewport.width, viewport.height]);
    await page.waitForTimeout(650);
    const canvasImage = await canvas.screenshot();
    const corner = await screenshotPixel(page, canvasImage, 4, Math.floor(viewport.height / 2));
    const expected = surface.slice(1).match(/.{2}/g)!.map((channel) => Number.parseInt(channel, 16));
    expect(corner.reduce((difference, channel, index) => difference + Math.abs(channel - expected[index]), 0))
      .toBeLessThan(18);
    await page.screenshot({ path: testInfo.outputPath(`theme-home-${viewport.name}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("Gallery canvas has no bounds.");
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    const preview = page.locator('[data-preview-track-id="theme-one"]');
    await expect(preview).toHaveAttribute("data-phase", "visible");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "artwork");
    if (viewport.name === "mobile") {
      const counter = await page.getByRole("button", { name: "关闭歌曲预览，返回每日推荐" }).boundingBox();
      const navigation = await page.getByRole("navigation").boundingBox();
      expect(counter).not.toBeNull();
      expect(navigation).not.toBeNull();
      expect(counter!.y).toBeGreaterThanOrEqual(navigation!.y + navigation!.height);
    }
    await page.screenshot({ path: testInfo.outputPath(`theme-preview-${viewport.name}.png`) });

    await page.goto("/track/theme-one");
    await expect(page.locator('[data-track-page-state="ready"]')).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "artwork");
    await page.waitForTimeout(650);
    const trackScreenshot = await page.screenshot({ path: testInfo.outputPath(`theme-track-${viewport.name}.png`) });
    const trackBackground = await screenshotPixel(page, trackScreenshot, 4, Math.floor(viewport.height / 2));
    expect(trackBackground.reduce((difference, channel, index) =>
      difference + Math.abs(channel - expected[index]), 0)).toBeLessThan(18);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  }
});

test("keeps manual INK and PAPER readable with a matching canvas at three viewports", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await installRoutes(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const canvas = page.getByLabel("Interactive daily track gallery");
    await expect(canvas).toBeVisible();
    for (const [label, kind] of [["浅色", "paper"], ["深色", "ink"]] as const) {
      await chooseTheme(page, label);
      await page.waitForTimeout(650);
      await expectReadableTheme(page, kind);
      const screenshot = await canvas.screenshot();
      const corner = await screenshotPixel(page, screenshot, 4, Math.floor(viewport.height / 2));
      const expected = rgb(await canvas.evaluate((element) =>
        window.getComputedStyle(element).backgroundColor));
      expect(Math.abs(corner[0] - expected.r) + Math.abs(corner[1] - expected.g)
        + Math.abs(corner[2] - expected.b)).toBeLessThan(18);
      await page.screenshot({ path: testInfo.outputPath(`theme-${kind}-${viewport.name}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    }
  }
});

test("preserves the previous palette during a delayed switch, then applies the new palette", async ({ page }) => {
  const routes = await installRoutes(page, { secondCover: "delayed" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "artwork");
  const initialSurface = await page.locator("html").evaluate((element) =>
    element.style.getPropertyValue("--ef-artwork-surface"));
  const canvas = page.getByLabel("Interactive daily track gallery");
  await canvas.press("End");
  await expect(page.locator('[data-track-id="theme-two"]')).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "artwork");
  expect(await page.locator("html").evaluate((element) =>
    element.style.getPropertyValue("--ef-artwork-surface"))).toBe(initialSurface);
  await routes.releaseSecond();
  await expect.poll(async () => page.locator("html").evaluate((element) =>
    element.style.getPropertyValue("--ef-artwork-surface"))).not.toBe(initialSurface);
});

test("supports manual modes, saved preference, failed artwork, and Reduced Motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installRoutes(page, { secondCover: "failed" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "artwork");
  await chooseTheme(page, "浅色");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(242, 240, 234)");
  expect(await page.locator("html").evaluate((element) =>
    window.getComputedStyle(element).transitionDuration)).toContain("1e-05s");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await chooseTheme(page, "封面");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "artwork");
  const canvas = page.getByLabel("Interactive daily track gallery");
  await canvas.press("End");
  await expect(page.locator('[data-track-id="theme-two"]')).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ink");
  await chooseTheme(page, "深色");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ink");
});

test("keeps guests and a failed daily read in INK", async ({ page }) => {
  await installRoutes(page, { authenticated: false });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ink");
  await page.getByRole("button", { name: "显示主题" }).click();
  await expect(page.getByRole("button", { name: "浅色" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "封面" })).toBeDisabled();
});

test("forces INK when daily recommendations fail despite a saved PAPER preference", async ({ page }) => {
  await installRoutes(page, { dailyFailure: true });
  await page.addInitScript(() => localStorage.setItem("echoform:theme-preference", "paper"));
  await page.goto("/");
  await expect(page.locator('[data-state="error"]')).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ink");
});
