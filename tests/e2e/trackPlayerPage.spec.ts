import { expect, test, type Page } from "@playwright/test";

import type { Track } from "../../src/lib/music/models";

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

const wordLyrics = {
  kind: "synced",
  lines: [
    {
      startMs: 1_000,
      durationMs: 1_000,
      text: "Sound becomes form",
      translation: "声音成为形状",
      romanization: null,
      words: [
        { startMs: 1_000, durationMs: 400, text: "Sound " },
        { startMs: 1_400, durationMs: 600, text: "becomes form" },
      ],
    },
    {
      startMs: 2_000,
      durationMs: null,
      text: "Motion becomes memory",
      translation: null,
      romanization: null,
      words: null,
    },
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
      requestId: "track-page-e2e",
      retryable: true,
    },
  });
}

async function installTrackPageRoutes(
  page: Page,
  options: {
    comments?: (offset: number) => unknown;
    commentFailure?: boolean;
    lyrics?: unknown;
    lyricFailure?: boolean;
    sourceFailure?: boolean;
  } = {},
): Promise<void> {
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: success({ mode: "real", user: null }),
    });
  });
  await page.route("**/api/tracks/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/comments")) {
      if (options.commentFailure) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: failure("评论服务暂时不可用。"),
        });
        return;
      }

      const offset = Number(new URL(route.request().url()).searchParams.get("offset") ?? "0");
      await route.fulfill({
        contentType: "application/json",
        body: success(options.comments?.(offset) ?? {
          items: [],
          total: 0,
          hasMore: false,
          limit: 10,
          offset,
        }),
      });
      return;
    }

    if (pathname.endsWith("/lyrics")) {
      if (options.lyricFailure) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: failure("歌词服务暂时不可用。"),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: success(options.lyrics ?? wordLyrics),
      });
      return;
    }

    if (pathname.endsWith("/source")) {
      if (options.sourceFailure) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: failure("播放源暂时不可用。"),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: success({
          url: "/e2e-track-page-audio.wav",
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

    await route.fulfill({ contentType: "application/json", body: success(track) });
  });
  await page.route("**/e2e-track-page-audio.wav", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });
}

async function loadMetadata(page: Page): Promise<void> {
  await page.locator("[data-echoform-audio]").evaluate((element) => {
    const audio = element as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 183 });
    audio.dispatchEvent(new Event("loadedmetadata"));
  });
  await expect(page.locator("[data-player-visible='true']")).toHaveAttribute("data-state", "ready");
}

test.describe.configure({ mode: "serial" });

test("renders the track route as an ordinary scrollable page without gallery exit behavior", async ({ page }) => {
  await installTrackPageRoutes(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/track/track-001");

  await expect(page.getByRole("heading", { name: track.name })).toBeVisible();
  await expect(page.locator("[data-track-page-state='ready']")).toBeVisible();
  await expect(page.locator("[data-lyrics-state='synced']")).toBeVisible();
  await expect(page.locator("audio")).toHaveCount(1);
  await page.mouse.wheel(0, 280);
  await expect(page).toHaveURL(/\/track\/track-001$/);
  await expect(page.getByRole("heading", { name: track.name })).toBeVisible();
});

test("uses audio time for word highlighting, lyric seek, browsing lock, and route persistence", async ({ page }) => {
  await installTrackPageRoutes(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/track/track-001");
  await page.getByRole("button", { name: `播放 ${track.name}` }).click();
  await expect(page.locator("[data-player-visible='true']")).toContainText(track.name);
  await loadMetadata(page);

  await page.locator("[data-echoform-audio]").evaluate((element) => {
    const audio = element as HTMLAudioElement;
    audio.currentTime = 1.5;
    audio.dispatchEvent(new Event("timeupdate"));
  });
  const activeLine = page.getByRole("button", { name: "跳转到 0:01：Sound becomes form" });
  await expect(activeLine).toHaveAttribute("data-active", "true");
  await expect(page.getByText("becomes form")).toHaveAttribute("data-active", "true");

  await page.getByRole("button", { name: "跳转到 0:02：Motion becomes memory" }).click();
  await expect.poll(async () => page.locator("[data-echoform-audio]").evaluate((element) => (
    (element as HTMLAudioElement).currentTime
  ))).toBe(2);

  await page.locator("[data-lyrics-lines]").hover();
  await page.mouse.wheel(0, 80);
  await expect(page.getByRole("button", { name: "回到当前" })).toBeVisible();
  await page.getByRole("button", { name: "回到当前" }).click();
  await expect(page.getByRole("button", { name: "回到当前" })).toBeHidden();

  const audioHandle = await page.locator("[data-echoform-audio]").evaluateHandle((element) => element);
  await page.getByRole("link", { name: "搜索" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.locator("[data-echoform-audio]")).toHaveCount(1);
  await expect(await page.locator("[data-echoform-audio]").evaluate((element, previous) => (
    element === previous
  ), audioHandle)).toBe(true);
});

test("keeps lyric failure local, reports source unavailability, and fits three required viewports", async ({ page }, testInfo) => {
  await installTrackPageRoutes(page, { lyricFailure: true });
  await page.goto("/track/track-001");
  await expect(page.getByRole("heading", { name: track.name })).toBeVisible();
  await expect(page.getByText("歌词服务暂时不可用。")).toBeVisible();
  await expect(page.getByRole("button", { name: `播放 ${track.name}` })).toBeEnabled();

  await page.unroute("**/api/tracks/**");
  await installTrackPageRoutes(page, { sourceFailure: true });
  await page.getByRole("button", { name: `播放 ${track.name}` }).click();
  await expect(page.locator("[data-player-error]")).toContainText("播放源暂时不可用。");

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto("/track/track-001");
    await expect(page.getByRole("heading", { name: track.name })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`track-page-${viewport.name}.png`) });
  }
});

test("uses plain and unavailable lyric documents as normal states", async ({ page }) => {
  await installTrackPageRoutes(page, {
    lyrics: {
      kind: "plain",
      lines: [{
        startMs: 0,
        durationMs: null,
        text: "A plain lyric",
        translation: null,
        romanization: null,
        words: null,
      }],
    },
  });
  await page.goto("/track/track-001");
  await expect(page.getByText("A plain lyric")).toBeVisible();
  await expect(page.locator("[data-lyrics-state='plain']")).toBeVisible();
});

test("uses a bounded comments drawer and safe queue sheet across desktop and mobile", async ({ page }, testInfo) => {
  const firstComment = {
    id: "comment-001",
    author: { id: "author-001", nickname: "First Listener", avatarUrl: null, signature: null },
    content: "First comment",
    createdAt: 1_735_689_600_000,
    likedCount: 1,
    likedByCurrentUser: false,
    replyTo: null,
  };
  const secondComment = {
    ...firstComment,
    id: "comment-002",
    content: "Second comment",
    likedCount: 4,
  };
  await installTrackPageRoutes(page, {
    comments: (offset) => offset === 0 ? {
      items: [firstComment],
      total: 2,
      hasMore: true,
      limit: 10,
      offset,
    } : {
      items: [secondComment],
      total: 2,
      hasMore: false,
      limit: 10,
      offset,
    },
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/track/track-001");
  await expect(page.getByRole("heading", { name: track.name })).toBeVisible();

  await page.getByRole("button", { name: "评论" }).click();
  const commentsPanel = page.getByRole("dialog", { name: "评论" });
  await expect(commentsPanel).toBeVisible();
  await expect(page.getByText("First comment")).toBeVisible();
  const desktopBox = await commentsPanel.boundingBox();
  expect(desktopBox?.width).toBeGreaterThanOrEqual(400);
  expect(desktopBox?.width).toBeLessThanOrEqual(480.1);

  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(page.getByText("Second comment")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(commentsPanel).toBeHidden();
  await expect(page.getByRole("button", { name: "评论" })).toBeFocused();

  await page.getByRole("button", { name: `播放 ${track.name}` }).click();
  await page.getByRole("button", { name: "队列" }).click();
  const queuePanel = page.getByRole("dialog", { name: "队列" });
  await expect(queuePanel).toBeVisible();
  await expect(page.getByRole("button", { name: `当前歌曲，${track.name}` }))
    .toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: `从队列移除 ${track.name}` }).click();
  await expect(page.getByText("队列中没有下一首")).toBeVisible();
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByRole("button", { name: `当前歌曲，${track.name}` }))
    .toHaveAttribute("aria-current", "true");

  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "评论" }).click();
  await expect(commentsPanel).toBeVisible();
  const mobileBox = await commentsPanel.boundingBox();
  expect(mobileBox?.width).toBe(390);
  expect(mobileBox?.height).toBeLessThanOrEqual(659.1);
  await expect.poll(async () => {
    const box = await commentsPanel.boundingBox();
    return (box?.y ?? 0) + (box?.height ?? 0);
  }).toBeLessThanOrEqual(844.1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("track-page-comments-mobile.png") });
});
