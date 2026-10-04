import { expect, test } from "@playwright/test";

const owner = { id: "701", nickname: "Synthetic Owner", avatarUrl: null, signature: null };
const playlist = {
  id: "801", name: "Synthetic Playlist", description: "A local fixture playlist.", tags: [], artworkUrl: null,
  owner, visibility: "public", trackCount: 1, createdAt: null, updatedAt: null,
};
const track = {
  id: "101", name: "Synthetic Track", artists: [{ id: "201", name: "Synthetic Artist", avatarUrl: null }],
  album: { id: "301", name: "Synthetic Album", artworkUrl: null },
  durationMs: 180_000, artworkUrl: null, aliases: [], explicit: false,
  availability: "unknown", privilege: { fee: 0, maxQuality: null },
};
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

test("renders a public playlist and local share fallback at three viewports", async ({ page }, testInfo) => {
  await page.route("**/api/playlists/801", async (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ok: true, data: { playlist, tracks: [track], canEdit: false } }),
  }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { (window as Window & { copiedPlaylistUrl?: string }).copiedPlaylistUrl = value; } },
    });
  });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const response = await page.goto("/playlist/801");
    expect(response?.ok()).toBe(true);
    await expect(page.getByRole("heading", { level: 1, name: "Synthetic Playlist" })).toBeVisible();
    await expect(page.getByRole("link", { name: /查看 Synthetic Track/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`playlist-${viewport.name}.png`) });
  }
  await page.getByRole("button", { name: "分享" }).click();
  await expect(page.getByText("本站歌单链接已复制。")).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { copiedPlaylistUrl?: string }).copiedPlaylistUrl)).toBe("http://127.0.0.1:3100/playlist/801");
});

test("creates a private playlist only after the BFF confirms it", async ({ page }) => {
  let created = false;
  let confirmWrite: (() => void) | undefined;
  await page.route("**/api/auth/session", async (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ ok: true, data: { mode: "real", user: owner } }),
  }));
  await page.route("**/api/library/likes?*", async (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ ok: true, data: { items: [], total: 0, limit: 50, offset: 0, hasMore: false } }),
  }));
  await page.route("**/api/library/albums?*", async (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ ok: true, data: { items: [], total: 0, limit: 50, offset: 0, hasMore: false } }),
  }));
  await page.route("**/api/users/701/playlists?*", async (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ ok: true, data: { liked: null, created: created ? [{ ...playlist, visibility: "private" }] : [], subscribed: [] } }),
  }));
  await page.route("**/api/playlists", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    expect(route.request().postDataJSON()).toMatchObject({ visibility: "private" });
    await new Promise<void>((resolve) => { confirmWrite = resolve; });
    created = true;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { ...playlist, visibility: "private" } }) });
  });
  await page.goto("/library");
  await page.getByRole("tab", { name: "歌单" }).click();
  await page.getByRole("button", { name: "创建歌单" }).click();
  await page.getByLabel("名称").fill("Synthetic Playlist");
  await page.getByLabel("私密").check();
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "创建歌单" })).toBeVisible();
  await expect(page.getByRole("link", { name: "查看歌单 Synthetic Playlist" })).toHaveCount(0);
  await expect.poll(() => Boolean(confirmWrite)).toBe(true);
  confirmWrite?.();
  await expect(page.getByRole("link", { name: "查看歌单 Synthetic Playlist" })).toBeVisible();
});

test("edits fields and confirms private-to-public publishing at three viewports", async ({ page }, testInfo) => {
  let current = { ...playlist, visibility: "private", tags: ["Electronic"] };
  const fields: string[] = [];
  await page.route("**/api/auth/session", async (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ ok: true, data: { mode: "real", user: owner } }),
  }));
  await page.route("**/api/playlists/801", async (route) => {
    if (route.request().method() === "PATCH") {
      const update = route.request().postDataJSON() as { field: string; value?: string | string[] };
      fields.push(update.field);
      if (update.field === "name") current = { ...current, name: String(update.value) };
      if (update.field === "description") current = { ...current, description: String(update.value) };
      if (update.field === "tags") current = { ...current, tags: update.value as string[] };
      if (update.field === "publish") current = { ...current, visibility: "public" };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { playlistId: "801", field: update.field } }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { playlist: current, tracks: [], canEdit: true } }) });
  });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/playlist/801");
    await expect(page.getByRole("button", { name: "编辑" })).toBeVisible();
    await page.getByRole("button", { name: "编辑" }).click();
    await expect(page.getByRole("heading", { name: "编辑歌单" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`playlist-edit-${viewport.name}.png`) });
    await page.getByRole("button", { name: "取消" }).click();
  }
  await page.getByRole("button", { name: "编辑" }).click();
  await page.getByLabel("名称").fill("Renamed Playlist");
  await page.getByLabel("描述").fill("Updated description");
  await page.getByLabel(/标签/).fill("Ambient, Electronic");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Renamed Playlist" })).toBeVisible();
  expect(fields).toEqual(["name", "description", "tags"]);
  await page.getByRole("button", { name: "设为公开" }).click();
  await page.getByRole("button", { name: "取消" }).click();
  expect(fields).toHaveLength(3);
  await page.getByRole("button", { name: "设为公开" }).click();
  await page.getByRole("button", { name: "确认公开" }).click();
  await expect(page.getByText("公开歌单")).toBeVisible();
  expect(fields).toEqual(["name", "description", "tags", "publish"]);
});

test("lets the owner remove a track and delete with confirmation on mobile", async ({ page }, testInfo) => {
  let tracks = [track];
  let removed = 0;
  let deleted = 0;
  await page.setViewportSize(viewports[2]);
  await page.route("**/api/auth/session", async (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ ok: true, data: { mode: "real", user: owner } }),
  }));
  await page.route("**/api/library/likes?*", async (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ ok: true, data: { items: [], total: 0, limit: 50, offset: 0, hasMore: false } }),
  }));
  await page.route("**/api/library/albums?*", async (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ ok: true, data: { items: [], total: 0, limit: 50, offset: 0, hasMore: false } }),
  }));
  await page.route("**/api/playlists/801/tracks", async (route) => {
    removed += 1;
    tracks = [];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { playlistId: "801", operation: "remove", trackIds: ["101"] } }) });
  });
  await page.route("**/api/playlists/801", async (route) => {
    if (route.request().method() === "DELETE") {
      deleted += 1;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { playlistId: "801", deleted: true } }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { playlist: { ...playlist, trackCount: tracks.length }, tracks, canEdit: true } }) });
  });
  await page.goto("/playlist/801");
  await expect(page.getByRole("button", { name: "删除" })).toBeVisible();
  await expect(page.getByRole("button", { name: "从歌单移除 Synthetic Track" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("playlist-owner-mobile.png") });
  await page.getByRole("button", { name: "从歌单移除 Synthetic Track" }).click();
  await expect(page.getByRole("dialog", { name: "移除 Synthetic Track？" })).toBeVisible();
  expect(removed).toBe(0);
  await page.getByRole("dialog", { name: "移除 Synthetic Track？" }).getByRole("button", { name: "取消" }).click();
  expect(removed).toBe(0);
  await expect(page.getByRole("button", { name: "从歌单移除 Synthetic Track" })).toBeFocused();
  await page.getByRole("button", { name: "从歌单移除 Synthetic Track" }).click();
  await page.getByRole("dialog", { name: "移除 Synthetic Track？" }).getByRole("button", { name: "确认移除" }).click();
  await expect(page.getByRole("heading", { name: "这个歌单还没有歌曲" })).toBeVisible();
  expect(removed).toBe(1);
  await page.getByRole("button", { name: "删除" }).click();
  await page.getByRole("dialog", { name: "删除歌单？" }).getByRole("button", { name: "取消" }).click();
  expect(deleted).toBe(0);
  await page.getByRole("button", { name: "删除" }).click();
  await page.getByRole("dialog", { name: "删除歌单？" }).getByRole("button", { name: "确认删除" }).click();
  await expect(page).toHaveURL(/\/library$/);
  expect(deleted).toBe(1);
});

test("keeps the add-to-playlist menu within three viewport widths", async ({ page }, testInfo) => {
  await page.route("**/api/auth/session", async (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ ok: true, data: { mode: "real", user: owner } }),
  }));
  await page.route("**/api/library/likes?*", async (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ ok: true, data: { items: [], total: 0, limit: 50, offset: 0, hasMore: false } }),
  }));
  await page.route("**/api/library/albums?*", async (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ ok: true, data: { items: [], total: 0, limit: 50, offset: 0, hasMore: false } }),
  }));
  await page.route("**/api/users/701/playlists?*", async (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ ok: true, data: { liked: null, created: [playlist], subscribed: [] } }),
  }));
  await page.route("**/api/tracks/101**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/lyrics") ? { kind: "unavailable", lines: [] }
      : path.endsWith("/comments") ? { items: [], total: 0, hasMore: false, limit: 10, offset: 0 }
        : track;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/track/101");
    await page.getByRole("button", { name: "将 Synthetic Track 加入歌单" }).click();
    const menu = page.getByRole("group", { name: "选择目标歌单" });
    await expect(menu.getByRole("button", { name: "Synthetic Playlist" })).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`playlist-menu-${viewport.name}.png`) });
  }
});
