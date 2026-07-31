import { expect, test, type Page, type Route } from "@playwright/test";
import { Buffer } from "node:buffer";

import type { SearchResponse, Track } from "../../src/lib/music/models";

const track: Track = {
  id: "track-001",
  name: "First Signal",
  artists: [{ id: "artist-001", name: "Echo Form", avatarUrl: null }],
  album: { id: "album-001", name: "Reference Record", artworkUrl: null },
  durationMs: 183_000,
  artworkUrl: null,
  aliases: [],
  explicit: false,
  availability: "playable",
  privilege: { fee: 0, maxQuality: "standard" },
};

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

function allResult(partial = false): SearchResponse {
  return {
    type: "all",
    tracks: { items: [track], total: 1, hasMore: false },
    artists: {
      items: partial ? [] : [{ id: "artist-001", name: "Echo Form", avatarUrl: null }],
      total: partial ? null : 1,
      hasMore: false,
    },
    albums: {
      items: [{ id: "album-001", name: "Reference Record", artworkUrl: null }],
      total: 1,
      hasMore: false,
    },
    partialErrors: partial ? [{
      type: "artist",
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
    }] : [],
  };
}

function success(data: SearchResponse): string {
  return JSON.stringify({ ok: true, data });
}

function failure(message: string): string {
  return JSON.stringify({
    ok: false,
    error: {
      code: "UPSTREAM_UNAVAILABLE",
      message,
      retryable: true,
      requestId: "search-e2e",
    },
  });
}

function createSilentWav(): Buffer {
  const sampleRate = 8_000;
  const durationSeconds = 30;
  const dataSize = sampleRate * durationSeconds * 2;
  const wav = Buffer.alloc(44 + dataSize);

  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);

  return wav;
}

async function fulfillJson(route: Route, body: string, status = 200): Promise<void> {
  await route.fulfill({ body, contentType: "application/json", status });
}

async function installBaseRoutes(page: Page): Promise<void> {
  await page.route("**/api/auth/session", async (route) => {
    await fulfillJson(route, JSON.stringify({ ok: true, data: { mode: "real", user: null } }));
  });
  await page.route("**/api/tracks/track-001/source", async (route) => {
    await fulfillJson(route, JSON.stringify({
      ok: true,
      data: {
        url: "/e2e-search-audio.wav",
        expiresAt: Date.now() + 60_000,
        quality: "standard",
        codec: "wav",
        bitrate: null,
        sampleRate: null,
        sizeBytes: null,
        corsMode: "anonymous",
      },
    }));
  });
  await page.route("**/e2e-search-audio.wav", async (route) => {
    await route.fulfill({ body: createSilentWav(), contentType: "audio/wav", status: 200 });
  });
}

test.describe.configure({ mode: "serial" });

test("renders all-search partial success, local result routes, and in-place playback", async ({ page }) => {
  await installBaseRoutes(page);
  await page.route("**/api/search?*", async (route) => {
    await fulfillJson(route, success(allResult(true)));
  });
  await page.setViewportSize(viewports[0]);
  await page.goto("/search");

  const input = page.getByLabel("搜索歌曲、歌手或专辑");
  await input.fill("signal");
  await expect(page.getByText("First Signal")).toBeVisible();
  await expect(page.getByText("歌手结果暂时不可用", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "查看 First Signal 的完整播放页" }))
    .toHaveAttribute("href", "/track/track-001");
  await expect(page.getByRole("link", { name: "查看专辑 Reference Record" }))
    .toHaveAttribute("href", "/album/album-001");

  await page.getByRole("button", { name: "播放 First Signal" }).click();
  await expect(page).toHaveURL(/\/search\?q=signal&type=all$/);
  await expect(page.locator("[data-player-visible='true']")).toContainText("First Signal");
  await expect(page.getByRole("button", { name: "暂停 First Signal" })).toBeVisible();
});

test("shows local loading, preserves valid results for errors, and gives empty results a recovery action", async ({ page }) => {
  await installBaseRoutes(page);
  let settleLoading: (() => Promise<void>) | undefined;
  await page.route("**/api/search?*", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "loading") {
      await new Promise<void>((resolve) => {
        settleLoading = async () => {
          await fulfillJson(route, success(allResult()));
          resolve();
        };
      });
      return;
    }
    if (query === "failure") {
      await fulfillJson(route, failure("搜索服务暂时不可用。"), 502);
      return;
    }
    if (query === "empty") {
      await fulfillJson(route, success({
        type: "all",
        tracks: { items: [], total: 0, hasMore: false },
        artists: { items: [], total: 0, hasMore: false },
        albums: { items: [], total: 0, hasMore: false },
        partialErrors: [],
      }));
      return;
    }
    await fulfillJson(route, success(allResult()));
  });
  await page.setViewportSize(viewports[1]);
  await page.goto("/search");

  const input = page.getByLabel("搜索歌曲、歌手或专辑");
  await input.fill("loading");
  await expect(page.getByText("正在更新")).toBeVisible();
  expect(settleLoading).toBeDefined();
  await settleLoading?.();
  await expect(page.getByText("First Signal")).toBeVisible();

  await input.fill("failure");
  await expect(page.getByText("无法更新搜索结果：搜索服务暂时不可用。", { exact: true })).toBeVisible();
  await expect(page.getByText("First Signal")).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toBeEnabled();

  await input.fill("empty");
  await expect(page.getByText("没有找到相关音乐")).toBeVisible();
  await page.getByRole("button", { name: "修改关键词" }).click();
  await expect(input).toBeFocused();
});

test("paginates one typed result list, restores q/type with Back, and fits three viewports", async ({ page }, testInfo) => {
  await installBaseRoutes(page);
  const secondTrack = { ...track, id: "track-002", name: "Second Signal" };
  await page.route("**/api/search?*", async (route) => {
    const url = new URL(route.request().url());
    const type = url.searchParams.get("type");
    const offset = url.searchParams.get("offset");
    if (type === "track") {
      await fulfillJson(route, success(offset === "0" ? {
        type: "track",
        items: [track],
        total: 2,
        limit: 20,
        offset: 0,
        hasMore: true,
      } : {
        type: "track",
        items: [secondTrack],
        total: 2,
        limit: 20,
        offset: 1,
        hasMore: false,
      }));
      return;
    }
    await fulfillJson(route, success(allResult()));
  });

  await page.setViewportSize(viewports[0]);
  await page.goto("/search?q=signals&type=track");
  await expect(page.getByText("First Signal")).toBeVisible();
  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(page.getByText("Second Signal")).toBeVisible();
  await expect(page.getByText("First Signal")).toBeVisible();

  await page.getByRole("tab", { name: "综合" }).click();
  await expect(page).toHaveURL(/\/search\?q=signals&type=all$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/search\?q=signals&type=track$/);
  await expect(page.getByRole("tab", { name: "歌曲" })).toHaveAttribute("aria-selected", "true");

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/search?q=signals&type=track");
    await expect(page.getByText("First Signal")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`search-${viewport.name}.png`) });
  }
});
