import { expect, test, type Page, type Route } from "@playwright/test";

const user = { id: "9001", nickname: "Synthetic Listener", avatarUrl: null, signature: null };
const track = {
  id: "201", name: "Recommended Signal",
  artists: [{ id: "301", name: "Synthetic Artist", avatarUrl: null }],
  album: { id: "401", name: "Synthetic Album", artworkUrl: null },
  durationMs: 180_000, artworkUrl: null, aliases: [], explicit: false,
  availability: "playable", privilege: { fee: 0, maxQuality: "standard" },
};
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function json(route: Route, data: unknown, status = 200): Promise<void> {
  await route.fulfill({ body: JSON.stringify(data), contentType: "application/json", status });
}

async function installRoutes(page: Page, state: {
  mode: "real" | "demo";
  recommendation: "success" | "empty" | "partial" | "failure" | "auth";
}): Promise<void> {
  await page.route("**/api/auth/session", (route) => json(route, {
    ok: true, data: { mode: state.mode, user: state.mode === "real" ? user : null },
  }));
  await page.route("**/api/search/hot", (route) => json(route, {
    ok: true,
    data: { source: state.mode, items: state.mode === "real" ? [{ rank: 1, text: "Synthetic Hot Term" }] : [] },
  }));
  await page.route("**/api/discovery/new-songs?*", (route) => json(route, { ok: true, data: [] }));
  await page.route("**/api/discovery/popular-playlists?*", (route) => json(route, {
    ok: true, data: { items: [], total: 0, limit: 8, offset: 0, hasMore: false },
  }));
  await page.route("**/api/search?*", (route) => json(route, {
    ok: true, data: {
      type: "all",
      tracks: { items: [], total: 0, hasMore: false },
      artists: { items: [], total: 0, hasMore: false },
      albums: { items: [], total: 0, hasMore: false },
      partialErrors: [],
    },
  }));
  await page.route("**/api/recommendations/rules", (route) => {
    if (state.recommendation === "auth") {
      return json(route, { ok: false, error: {
        code: "SESSION_EXPIRED", message: "Synthetic expired login.",
        retryable: false, requestId: "rules-auth-e2e",
      } }, 401);
    }
    if (state.recommendation === "failure") {
      return json(route, { ok: false, error: {
        code: "UPSTREAM_UNAVAILABLE", message: "Synthetic recommendation failure.",
        retryable: true, requestId: "rules-e2e",
      } }, 502);
    }
    return json(route, { ok: true, data: {
      date: "2026-10-05", source: "real", historyWindowDays: 30,
      historySampleSize: 0, likedSampleSize: state.recommendation === "empty" ? 0 : 1,
      failedSeedCount: state.recommendation === "partial" ? 1 : 0,
      failedAvailabilityCount: state.recommendation === "partial" ? 2 : 0,
      items: state.recommendation === "empty" ? [] : [{
        track, score: 40,
        reasons: [{ seedId: "101", seedName: "Liked Signal", source: "liked" }],
      }],
    } });
  });
}

test("shows Real hot terms, scoped recent search and explained rules at three viewports", async ({ page }, testInfo) => {
  const state = { mode: "real" as const, recommendation: "success" as const };
  await installRoutes(page, state);
  await page.goto("/search");
  await expect(page.getByRole("button", { name: /Synthetic Hot Term/ })).toBeVisible();
  await expect(page.getByText("Recommended Signal")).toBeVisible();
  await expect(page.getByText(/依据：喜欢「Liked Signal」/)).toBeVisible();
  await page.getByLabel("搜索歌曲、歌手或专辑").fill("Recent Signal");
  await expect(page.getByText("没有找到相关音乐")).toBeVisible();
  await page.getByLabel("搜索歌曲、歌手或专辑").fill("");
  await expect(page.getByRole("heading", { name: "最近搜索" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recent Signal" })).toBeVisible();

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { name: "热搜" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.getByRole("heading", { name: "根据你的喜欢与最近播放" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`rules-${viewport.name}.png`) });
  }
});

test("labels partial Real recommendation evidence without hiding verified tracks", async ({ page }) => {
  await installRoutes(page, { mode: "real", recommendation: "partial" });
  await page.goto("/search");
  await expect(page.getByText("Recommended Signal")).toBeVisible();
  await expect(page.getByText(/1 个种子暂时未能读取/)).toBeVisible();
  await expect(page.getByText(/2 首候选暂时无法验证可播性/)).toBeVisible();
  await expect(page.getByText(/来源：当前喜欢歌曲 1 首/)).toBeVisible();
});

test("offers renewed QR login for a Real recommendation auth failure", async ({ page }) => {
  await installRoutes(page, { mode: "real", recommendation: "auth" });
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "登录状态已失效" })).toBeVisible();
  await expect(page.getByText("Synthetic expired login.")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新扫码" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试推荐" })).toHaveCount(0);
});

test("keeps empty and failed Real results explicit, then isolates Demo", async ({ page }) => {
  const state: { mode: "real" | "demo"; recommendation: "success" | "empty" | "failure" } = {
    mode: "real", recommendation: "empty",
  };
  await installRoutes(page, state);
  await page.goto("/search");
  await expect(page.getByText("还没有可用于推荐的喜欢歌曲或当前身份有效播放记录。")).toBeVisible();
  state.recommendation = "failure";
  await page.reload();
  await expect(page.getByRole("heading", { name: "规则推荐暂时不可用" })).toBeVisible();
  await expect(page.getByText("Synthetic recommendation failure.")).toBeVisible();
  state.mode = "demo";
  await page.reload();
  await expect(page.getByText("演示模式没有真实喜欢与可播相似曲，不显示 Real 推荐。")).toBeVisible();
  await expect(page.getByText("演示模式不提供真实热搜榜单。")).toBeVisible();
  await expect(page.getByText("Recommended Signal")).toHaveCount(0);
});
