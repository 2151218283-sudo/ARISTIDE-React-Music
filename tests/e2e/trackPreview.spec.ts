import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { Track } from "../../src/lib/music/models";

const baseTrack: Omit<Track, "id" | "name"> = {
  artists: [{ id: "artist-001", name: "Echo Form", avatarUrl: null }],
  album: { id: "album-001", name: "Reference Record", artworkUrl: null },
  durationMs: 183_000,
  artworkUrl: null,
  aliases: [],
  explicit: false,
  availability: "playable",
  privilege: { fee: 0, maxQuality: null },
};

const tracks: Track[] = [
  { ...baseTrack, id: "track-001", name: "First Signal" },
  { ...baseTrack, id: "track-002", name: "Middle Signal" },
  { ...baseTrack, id: "track-003", name: "Last Signal" },
];

const lyrics = {
  kind: "synced",
  lines: [
    { startMs: 0, durationMs: null, text: "Sound becomes form", translation: null, romanization: null, words: null },
    { startMs: 1_000, durationMs: null, text: "Motion becomes memory", translation: null, romanization: null, words: null },
  ],
};

function success(data: unknown): string {
  return JSON.stringify({ ok: true, data });
}

function failure(message: string): string {
  return JSON.stringify({
    ok: false,
    error: {
      code: "UPSTREAM_UNAVAILABLE",
      message,
      requestId: "preview-e2e",
      retryable: true,
    },
  });
}

async function installPreviewRoutes(
  page: Page,
  dailyTracks: Track[] = tracks,
): Promise<void> {
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: success({ mode: "real", user: null }),
    });
  });
  await page.route("**/api/recommendations/daily", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: success({ date: "2026-07-31", source: "public", tracks: dailyTracks }),
    });
  });
  await page.route("**/api/tracks/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const parts = pathname.split("/").filter(Boolean);
    const trackId = decodeURIComponent(parts[2] ?? "");
    const track = dailyTracks.find((candidate) => candidate.id === trackId) ?? dailyTracks[0];

    if (pathname.endsWith("/lyrics")) {
      await route.fulfill({ contentType: "application/json", body: success(lyrics) });
      return;
    }
    if (pathname.endsWith("/source")) {
      await route.fulfill({
        contentType: "application/json",
        body: success({
          url: "/e2e-preview-audio.wav",
          expiresAt: Date.now() + 60_000,
          quality: "standard",
          codec: "wav",
          bitrate: null,
          sampleRate: null,
          sizeBytes: null,
          corsMode: "anonymous",
        }),
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: success({
        ...track,
        album: { ...track.album, name: `${track.album.name} Resolved` },
      }),
    });
  });
  await page.route("**/e2e-preview-audio.wav", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });
}

async function clickCurrentCanvasTrack(page: Page): Promise<void> {
  const canvas = page.getByLabel("Interactive daily track gallery");
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("The gallery Canvas has no visible bounds.");
  }
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

async function expectPreviewReady(page: Page, trackId: string): Promise<void> {
  const preview = page.locator(`[data-preview-track-id="${trackId}"]`);
  const canvas = page.getByLabel("Interactive daily track gallery");
  await expect(preview).toBeVisible();
  await expect.poll(async () => Number(await canvas.getAttribute("data-preview-progress")))
    .toBeGreaterThan(0.98);
  await expect(preview).toHaveAttribute("data-phase", "visible");
}

async function expectCanvasNonblank(page: Page): Promise<void> {
  const canvas = page.getByLabel("Interactive daily track gallery");
  await expect.poll(async () => canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) {
      return false;
    }
    const context = element.getContext("webgl2") ?? element.getContext("webgl");
    if (!context || context.isContextLost() || element.width === 0 || element.height === 0) {
      return false;
    }
    const sampleWidth = Math.min(element.width, 720);
    const sampleHeight = Math.min(element.height, 450);
    const pixels = new Uint8Array(sampleWidth * sampleHeight * 4);
    context.readPixels(
      0,
      0,
      sampleWidth,
      sampleHeight,
      context.RGBA,
      context.UNSIGNED_BYTE,
      pixels,
    );
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        Math.abs(pixels[index] - 12) > 8
        || Math.abs(pixels[index + 1] - 13) > 8
        || Math.abs(pixels[index + 2] - 13) > 8
      ) {
        return true;
      }
    }
    return false;
  })).toBe(true);
}

async function savePreviewScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`track-preview-${name}.png`) });
}

test.describe.configure({ mode: "serial" });

test("plays during entry, consumes the first wheel, and preserves playback after exit", async ({ page }) => {
  await installPreviewRoutes(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator('[data-track-id="track-001"]')).toBeVisible();

  await clickCurrentCanvasTrack(page);
  const preview = page.locator('[data-preview-track-id="track-001"]');
  await expect(preview).toHaveAttribute("data-phase", "entering");
  await page.getByRole("button", { name: "播放 First Signal" }).click();
  await expect(page.locator('[data-player-visible="true"]')).toContainText("First Signal");

  await page.mouse.wheel(0, 120);
  await expect(preview).toHaveAttribute("data-phase", "exiting");
  await expect(preview).toBeHidden({ timeout: 1_000 });
  await expect(page.locator('[data-track-id="track-001"]')).toBeVisible();
  await expect(page.locator('[data-player-visible="true"]')).toContainText("First Signal");
  await expect(page.getByLabel("Interactive daily track gallery")).toBeFocused();
});

test("opens and restores the first, middle, and last finite gallery tracks", async ({ page }) => {
  await installPreviewRoutes(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const canvas = page.getByLabel("Interactive daily track gallery");

  for (const [index, track] of tracks.entries()) {
    if (index === 1) {
      await canvas.press("ArrowRight");
    } else if (index === 2) {
      await canvas.press("End");
    }
    await expect(page.locator(`[data-track-id="${track.id}"]`)).toBeVisible();
    await clickCurrentCanvasTrack(page);
    await expectPreviewReady(page, track.id);
    await page.getByRole("button", {
      name: "关闭歌曲预览，返回每日推荐",
    }).click();
    await expect(page.locator(`[data-preview-track-id="${track.id}"]`)).toBeHidden({ timeout: 1_000 });
    await expect(page.locator(`[data-track-id="${track.id}"]`)).toBeVisible();
  }
});

test("supports Escape and the visible back control while entry remains interruptible", async ({ page }) => {
  await installPreviewRoutes(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");

  await clickCurrentCanvasTrack(page);
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-preview-track-id="track-001"]')).toBeHidden({ timeout: 1_000 });

  await clickCurrentCanvasTrack(page);
  await page.getByRole("button", { exact: true, name: "返回每日推荐" }).click();
  await expect(page.locator('[data-preview-track-id="track-001"]')).toBeHidden({ timeout: 1_000 });
});

test("retains daily data through detail error, lyric error, and explicit retry", async ({ page }) => {
  let recoverDetails = false;
  await installPreviewRoutes(page);
  await page.route("**/api/tracks/track-001", async (route) => {
    if (!recoverDetails) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: failure("歌曲详情暂时不可用。"),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: success({
        ...tracks[0],
        album: { ...tracks[0].album, name: "Recovered Record" },
      }),
    });
  });
  await page.route("**/api/tracks/track-001/lyrics", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: failure("歌词服务暂时不可用。"),
    });
  });
  await page.goto("/");
  await clickCurrentCanvasTrack(page);

  await expect(page.getByText("歌曲详情暂时不可用。")).toBeVisible();
  await expect(page.getByText("歌词摘要暂时不可用。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "First Signal" })).toBeVisible();
  recoverDetails = true;
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("Recovered Record")).toBeVisible();
});

test("uses the DOM artwork fallback and keeps the preview operable without Canvas", async ({ page }) => {
  await page.addInitScript(() => {
    const prototype = HTMLCanvasElement.prototype as unknown as {
      getContext(contextId: string, ...args: unknown[]): RenderingContext | null;
    };
    const nativeGetContext = prototype.getContext;
    prototype.getContext = function getContext(
      contextId: string,
      ...args: unknown[]
    ): RenderingContext | null {
      if (contextId === "webgl" || contextId === "webgl2" || contextId === "experimental-webgl") {
        return null;
      }
      return nativeGetContext.call(this, contextId, ...args);
    };
  });
  await installPreviewRoutes(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const fallback = page.locator('[data-renderer="fallback"]');
  await expect(fallback).toBeVisible();
  await page.getByRole("button", { name: /First Signal/ }).click();
  await expect(page.getByTestId("preview-dom-artwork")).toBeVisible();
  await expect(page.getByRole("link", { name: /First Signal/ }))
    .toHaveAttribute("href", "/track/track-001");
  await page.mouse.wheel(0, 80);
  await expect(page.locator('[data-preview-track-id="track-001"]')).toBeHidden({ timeout: 1_000 });
  await expect(page.locator('[data-renderer="fallback"] > div')).toBeFocused();
});

test("keeps the local Explore route and an unavailable Track truthful", async ({ page }) => {
  const unavailableTrack: Track = {
    ...tracks[0],
    availability: "vip",
    name: "Locked Signal",
    privilege: { fee: 1, maxQuality: null },
  };
  await installPreviewRoutes(page, [unavailableTrack]);
  await page.goto("/");
  await clickCurrentCanvasTrack(page);

  await expect(page.getByRole("button", { name: /VIP/ })).toBeDisabled();
  const explore = page.getByRole("link", { name: /Locked Signal/ });
  await expect(explore).toHaveAttribute("href", "/track/track-001");
  await explore.click();
  await expect(page).toHaveURL(/\/track\/track-001$/);
});

test("restores the selected gallery Track and playback after Explore and browser Back", async ({ page }) => {
  await installPreviewRoutes(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const canvas = page.getByLabel("Interactive daily track gallery");
  await canvas.press("ArrowRight");
  await expect(page.locator('[data-track-id="track-002"]')).toBeVisible();
  await clickCurrentCanvasTrack(page);
  await page.getByRole("button", { name: "播放 Middle Signal" }).click();
  await page.getByRole("link", { name: /Middle Signal/ }).click();

  await expect(page).toHaveURL(/\/track\/track-002$/);
  await expect(page.locator('[data-player-visible="true"]')).toContainText("Middle Signal");
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('[data-track-id="track-002"]')).toBeVisible();
  await expect(page.locator('[data-player-visible="true"]')).toContainText("Middle Signal");
});

test("stays nonblank and collision-free across the required preview viewports", async ({ page }, testInfo) => {
  await installPreviewRoutes(page);
  const viewports = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ] as const;

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await clickCurrentCanvasTrack(page);
    await expectPreviewReady(page, "track-001");
    await expectCanvasNonblank(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    await savePreviewScreenshot(page, testInfo, viewport.name);
  }
});

test.describe("Reduced Motion", () => {
  test("keeps the complete preview task path without delayed spatial motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installPreviewRoutes(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await clickCurrentCanvasTrack(page);

    await expect(page.locator('[data-preview-track-id="track-001"]'))
      .toHaveAttribute("data-phase", "visible", { timeout: 500 });
    await expect(page.getByRole("button", { name: "播放 First Signal" })).toBeVisible();
    await expect(page.getByRole("link", { name: /First Signal/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-preview-track-id="track-001"]')).toBeHidden({ timeout: 500 });
  });
});
