import { expect, test, type Page, type Route } from "@playwright/test";

import type { AlbumDetail, ArtistDetail, Track } from "../../src/lib/music/models";

const track: Track = {
  id: "101",
  name: "Catalog Signal",
  artists: [{ id: "201", name: "Catalog Artist", avatarUrl: null }],
  album: { id: "301", name: "Catalog Album", artworkUrl: null },
  durationMs: 180_000,
  artworkUrl: null,
  aliases: [],
  explicit: false,
  availability: "unknown",
  privilege: { fee: 0, maxQuality: "standard" },
};

const unavailableTrack: Track = {
  ...track,
  id: "102",
  name: "Restricted Signal",
  availability: "copyright",
};

const albumDetail: AlbumDetail = {
  album: {
    id: "301",
    name: "Catalog Album",
    artworkUrl: null,
    artists: [{ id: "201", name: "Catalog Artist", avatarUrl: null }],
    description: "Synthetic catalog album description.",
    publishedAt: null,
    trackCount: 2,
  },
  tracks: [unavailableTrack, track],
};

function artistDetail(offset: number, hasMore: boolean): ArtistDetail {
  return {
    artist: {
      id: "201",
      name: "Catalog Artist",
      avatarUrl: null,
      aliases: [],
      biography: null,
      albumCount: 2,
      trackCount: 1,
    },
    hotTracks: [track],
    albums: {
      items: [{
        id: offset === 0 ? "301" : "302",
        name: offset === 0 ? "Catalog Album" : "Second Catalog Album",
        artworkUrl: null,
      }],
      total: 2,
      limit: 20,
      offset,
      hasMore,
    },
  };
}

function success(data: unknown): string {
  return JSON.stringify({ ok: true, data });
}

function failure(code: string, message: string, retryable: boolean): string {
  return JSON.stringify({
    ok: false,
    error: { code, message, retryable, requestId: "catalog-e2e" },
  });
}

async function fulfillJson(route: Route, body: string, status = 200): Promise<void> {
  await route.fulfill({ body, contentType: "application/json", status });
}

async function installBaseRoutes(page: Page): Promise<void> {
  await page.route("**/api/auth/session", async (route) => {
    await fulfillJson(route, success({ mode: "real", user: null }));
  });
  await page.route("**/api/tracks/101/source", async (route) => {
    await fulfillJson(route, success({
      url: "/e2e-catalog-audio.wav",
      expiresAt: Date.now() + 60_000,
      quality: "standard",
      codec: "wav",
      bitrate: null,
      sampleRate: null,
      sizeBytes: null,
      corsMode: "anonymous",
    }));
  });
  await page.route("**/e2e-catalog-audio.wav", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });
}

test.describe.configure({ mode: "serial" });

test("renders a local album detail, preserves unavailable rows, and plays the first actionable track", async ({ page }, testInfo) => {
  await installBaseRoutes(page);
  await page.route("**/api/albums/301", async (route) => {
    await fulfillJson(route, success(albumDetail));
  });

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto("/album/301");
    await expect(page.getByRole("heading", { name: "Catalog Album" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Catalog Artist" }))
      .toHaveAttribute("href", "/artist/201");
    await expect(page.getByRole("button", { name: "歌曲因版权原因不可用 Restricted Signal" }))
      .toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`catalog-album-${viewport.name}.png`) });
  }

  await page.getByRole("button", { name: "播放全部" }).click();
  await expect(page.locator("[data-player-visible='true']")).toContainText("Catalog Signal");
  await expect(page).toHaveURL(/\/album\/301$/);
});

test("appends artist album pages through the local BFF without discarding loaded albums", async ({ page }) => {
  await installBaseRoutes(page);
  await page.route("**/api/artists/201?*", async (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get("offset") ?? "0");
    await fulfillJson(route, success(artistDetail(offset, offset === 0)));
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/artist/201");

  await expect(page.getByRole("heading", { name: "Catalog Artist" })).toBeVisible();
  await expect(page.getByRole("link", { name: "查看专辑 Catalog Album" }))
    .toHaveAttribute("href", "/album/301");
  await page.getByRole("button", { name: "加载更多专辑" }).click();
  await expect(page.getByRole("link", { name: "查看专辑 Second Catalog Album" })).toBeVisible();
  await expect(page.getByRole("link", { name: "查看专辑 Catalog Album" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
});

test("shows a local recoverable not-found catalog state", async ({ page }) => {
  await installBaseRoutes(page);
  await page.route("**/api/albums/999", async (route) => {
    await fulfillJson(route, failure("TRACK_UNAVAILABLE", "Synthetic missing album.", false), 404);
  });
  await page.goto("/album/999");

  await expect(page.getByRole("heading", { name: "未找到音乐条目" })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回搜索" })).toBeVisible();
});
