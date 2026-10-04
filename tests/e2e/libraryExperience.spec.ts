import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

function historyEntry(id: string, playedAt: number) {
  return {
    completed: false,
    playedAt,
    playedMs: 30_000,
    source: "local",
    track: {
      album: { artworkUrl: null, id: `album-${id}`, name: `Album ${id}` },
      aliases: [],
      artists: [{ id: `artist-${id}`, name: `Artist ${id}` }],
      artworkUrl: null,
      availability: "playable",
      durationMs: 120_000,
      explicit: false,
      id,
      name: `Track ${id}`,
      privilege: { fee: null, maxQuality: "standard" },
    },
    trackId: id,
  };
}

type HistoryRecord = ReturnType<typeof historyEntry>;

const demoTrack = {
  id: "demo-track-001",
  name: "Demo Signal",
  artists: [{ id: "demo-artist-001", name: "Demo Form", avatarUrl: null }],
  album: { id: "demo-album-001", name: "Demo Record", artworkUrl: null },
  durationMs: 180_000,
  artworkUrl: null,
  aliases: [],
  explicit: false,
  availability: "playable",
  privilege: { fee: 0, maxQuality: "standard" },
};

function success(data: unknown): string {
  return JSON.stringify({ ok: true, data });
}

function libraryPage<T>(items: T[]) {
  return { items, total: items.length, limit: 50, offset: 0, hasMore: false };
}

function historyTrackLink(page: Page, id: string) {
  return page.getByRole("link", { name: `查看 Track ${id} 的完整播放页` });
}

async function seedHistory(page: Page, count: number): Promise<void> {
  const entries = Array.from({ length: count }, (_, index) => (
    historyEntry(String(index + 1), 10_000 - index)
  ));
  await page.evaluate(async (records: HistoryRecord[]) => {
    const databaseName = "echoform-listening-history";
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(databaseName);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
      deletion.onblocked = () => resolve();
    });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("entries", { keyPath: "trackId" });
        store.createIndex("playedAt", "playedAt", { unique: false });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("entries", "readwrite");
        const store = transaction.objectStore("entries");
        records.forEach((record) => store.put(record));
        transaction.oncomplete = () => {
          request.result.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    window.dispatchEvent(new Event("echoform:history-changed"));
  }, entries);
}

test.describe.configure({ mode: "serial" });

test("confirms Demo like and unlike only after the same-origin write response", async ({ page }) => {
  let liked = false;
  let writeCount = 0;
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({ contentType: "application/json", body: success({ mode: "demo", user: null }) });
  });
  await page.route("**/api/library/likes**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: success(libraryPage(liked ? [demoTrack] : [])) });
      return;
    }
    liked = route.request().method() === "PUT";
    writeCount += 1;
    await route.fulfill({
      contentType: "application/json",
      body: success({ kind: "track-like", id: demoTrack.id, active: liked }),
    });
  });
  await page.route("**/api/library/albums**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: success(libraryPage([])) });
  });
  await page.route("**/api/tracks/demo-track-001**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/lyrics")) {
      await route.fulfill({ contentType: "application/json", body: success({ kind: "unavailable", lines: [] }) });
      return;
    }
    if (pathname.endsWith("/comments")) {
      await route.fulfill({ contentType: "application/json", body: success({ items: [], total: 0, hasMore: false, limit: 10, offset: 0 }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: success(demoTrack) });
  });

  await page.goto("/track/demo-track-001");
  const like = page.getByRole("button", { name: "喜欢 Demo Signal" });
  await expect(like).toBeEnabled();
  await like.click();
  await expect(page.getByRole("button", { name: "取消喜欢 Demo Signal" }))
    .toHaveAttribute("aria-pressed", "true");
  expect(writeCount).toBe(1);

  await page.getByRole("button", { name: "取消喜欢 Demo Signal" }).click();
  await expect(page.getByRole("button", { name: "喜欢 Demo Signal" }))
    .toHaveAttribute("aria-pressed", "false");
  expect(writeCount).toBe(2);
});

test("renders local history through the versioned IndexedDB adapter without an account", async ({ page }) => {
  await page.setViewportSize(viewports[0]);
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "登录后查看你的音乐库" })).toBeVisible();
  await page.getByRole("tab", { name: "播放记录" }).click();
  await expect(page.getByRole("button", { name: "使用网易云音乐登录" })).toBeVisible();
  await seedHistory(page, 51);

  await expect(historyTrackLink(page, "1")).toBeVisible();
  await expect(historyTrackLink(page, "51")).toHaveCount(0);
  await page.getByRole("button", { name: "显示更多" }).click();
  await expect(historyTrackLink(page, "51")).toBeVisible();

  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText("本地离线记录")).toBeVisible();
  await page.context().setOffline(false);

  const clearTrigger = page.getByRole("button", { name: "清空记录" });
  await clearTrigger.click();
  const clearDialog = page.getByRole("dialog", { name: "清空播放记录？" });
  await expect(clearDialog).toBeVisible();
  await clearDialog.getByRole("button", { name: "取消" }).click();
  await expect(historyTrackLink(page, "1")).toBeVisible();

  await clearTrigger.click();
  await clearDialog.getByRole("button", { name: "清空记录" }).click();
  await expect(clearDialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "还没有本地播放记录" })).toBeVisible();
  await expect(page.getByText("播放记录已清空。")).toBeVisible();
});

test("keeps the library readable and non-overflowing at three viewports", async ({ page }, testInfo) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/library");
    await expect(page.getByRole("heading", { level: 1, name: "音乐库" })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "音乐库分类" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "播放记录" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`library-${viewport.name}.png`) });
  }
});
