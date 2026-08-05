import { expect, test, type Page } from "@playwright/test";

import type { Track } from "../../src/lib/music/models";

const baseTrack: Omit<Track, "artworkUrl" | "id" | "name"> = {
  artists: [{ id: "artist-001", name: "Echo Form", avatarUrl: null }],
  album: { id: "album-001", name: "Reference Record", artworkUrl: null },
  durationMs: 180_000,
  aliases: [],
  explicit: false,
  availability: "playable",
  privilege: { fee: 0, maxQuality: null },
};

const tracks: Track[] = [
  { ...baseTrack, id: "track-001", name: "First Signal", artworkUrl: null },
  { ...baseTrack, id: "track-002", name: "Middle Signal", artworkUrl: null },
  { ...baseTrack, id: "track-003", name: "Last Signal", artworkUrl: null },
];

function success(data: unknown) {
  return JSON.stringify({ ok: true, data });
}

async function installDailyTracks(page: Page, nextTracks: Track[] = tracks): Promise<void> {
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: success({ mode: "real", user: null }),
    });
  });
  await page.route("**/api/recommendations/daily", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: success({ date: "2026-07-31", source: "public", tracks: nextTracks }),
    });
  });
}

async function measureGalleryFrames(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas[aria-label='Interactive daily track gallery']",
    );
    if (!canvas) {
      throw new Error("The gallery canvas is unavailable for frame measurement.");
    }

    const before = Number(canvas.dataset.renderCount ?? "0");
    const startedAt = performance.now();
    canvas.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 120,
    }));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
    const elapsedSeconds = (performance.now() - startedAt) / 1_000;
    const after = Number(canvas.dataset.renderCount ?? "0");
    return (after - before) / elapsedSeconds;
  });
}

test.describe.configure({ mode: "serial" });

test("uses normalized tracks in a finite, nonblank canvas gallery", async ({ page }) => {
  await installDailyTracks(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const gallery = page.getByRole("region", { name: "Daily track gallery" });
  const canvas = page.getByLabel("Interactive daily track gallery");
  await expect(gallery).toHaveAttribute("data-renderer", "canvas");
  await expect(gallery).toHaveAttribute("data-artwork-fallback", "true");
  await expect(canvas).toBeVisible();

  await canvas.press("End");
  await expect(page.locator('[data-track-id="track-003"]')).toBeVisible();
  await canvas.press("Home");
  await expect(page.locator('[data-track-id="track-001"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
});

test("retains the gallery after an artwork texture request fails", async ({ page }) => {
  const remoteArtworkTracks = tracks.map((track) => ({
    ...track,
    artworkUrl: "/missing-artwork.png",
  }));
  await installDailyTracks(page, remoteArtworkTracks);
  await page.route("**/missing-artwork.png", async (route) => {
    await route.abort();
  });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");

  const gallery = page.getByRole("region", { name: "Daily track gallery" });
  await expect(gallery).toHaveAttribute("data-renderer", "canvas");
  await expect(gallery).toHaveAttribute("data-artwork-fallback", "true");
  await expect(page.getByLabel("Interactive daily track gallery")).toBeVisible();
});

test("sleeps while idle and resumes a single gallery render chain", async ({ page }) => {
  const performanceTracks = Array.from({ length: 8 }, (_, index) => ({
    ...baseTrack,
    artworkUrl: null,
    id: `performance-${index + 1}`,
    name: `Performance Signal ${index + 1}`,
  }));
  await installDailyTracks(page, performanceTracks);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const canvas = page.getByLabel("Interactive daily track gallery");
  await expect(canvas).toHaveAttribute("data-gallery-quality", "full");
  await expect(canvas).toHaveAttribute("data-render-state", "idle");

  const idleRenderCount = await canvas.getAttribute("data-render-count");
  await page.waitForTimeout(120);
  await expect(canvas).toHaveAttribute("data-render-count", idleRenderCount ?? "");

  await canvas.hover({ position: { x: 720, y: 450 } });
  await expect.poll(async () => Number(await canvas.getAttribute("data-raycast-count")))
    .toBeGreaterThan(0);
  await expect(canvas).toHaveAttribute("data-render-state", "idle");
  const idleRaycastCount = await canvas.getAttribute("data-raycast-count");
  await page.waitForTimeout(120);
  await expect(canvas).toHaveAttribute("data-raycast-count", idleRaycastCount ?? "");

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(canvas).toHaveAttribute("data-render-state", "hidden");

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => Number(await canvas.getAttribute("data-render-count")))
    .toBeGreaterThan(Number(idleRenderCount));
  await expect(canvas).toHaveAttribute("data-render-state", "idle");
});

test("meets the fixed-fixture gallery frame budget at desktop and narrow widths", async ({ page }) => {
  const performanceTracks = Array.from({ length: 8 }, (_, index) => ({
    ...baseTrack,
    artworkUrl: null,
    id: `budget-${index + 1}`,
    name: `Budget Signal ${index + 1}`,
  }));
  await installDailyTracks(page, performanceTracks);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const canvas = page.getByLabel("Interactive daily track gallery");
  await expect(canvas).toHaveAttribute("data-render-state", "idle");
  const desktopFramesPerSecond = await measureGalleryFrames(page);
  expect(desktopFramesPerSecond).toBeGreaterThanOrEqual(55);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const narrowCanvas = page.getByLabel("Interactive daily track gallery");
  await expect(narrowCanvas).toHaveAttribute("data-gallery-quality", "constrained");
  await expect(narrowCanvas).toHaveAttribute("data-render-state", "idle");
  const narrowFramesPerSecond = await measureGalleryFrames(page);
  expect(narrowFramesPerSecond).toBeGreaterThanOrEqual(30);
});

test.describe("Canvas fallback", () => {
  test.use({ hasTouch: true });

  test("provides a keyboard and touch-operable fallback when Canvas initialization fails", async ({ page }) => {
    await page.addInitScript(() => {
      type CanvasContextGetter = (
        contextId: string,
        ...args: unknown[]
      ) => RenderingContext | null;
      const canvasPrototype = HTMLCanvasElement.prototype as unknown as {
        getContext: CanvasContextGetter;
      };
      const nativeGetContext = canvasPrototype.getContext;
      canvasPrototype.getContext = function getContext(
        contextId: string,
        ...args: unknown[]
      ): RenderingContext | null {
        if (contextId === "webgl" || contextId === "webgl2" || contextId === "experimental-webgl") {
          return null;
        }
        return nativeGetContext.call(this, contextId, ...args);
      };
    });
    await installDailyTracks(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const gallery = page.getByRole("region", { name: "Daily track gallery" });
    const fallback = page.getByLabel("可操作的歌曲画廊降级列表");
    await expect(gallery).toHaveAttribute("data-renderer", "fallback");
    await expect(fallback).toBeVisible();
    await expect(page.getByRole("button", { name: "上一首推荐歌曲" })).toBeDisabled();
    await page.getByRole("button", { name: "下一首推荐歌曲" }).tap();
    await expect(page.locator('[data-track-id="track-002"]')).toBeVisible();
    await fallback.press("End");
    await expect(page.locator('[data-track-id="track-003"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
