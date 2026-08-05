import { expect, test } from "@playwright/test";

const productRoutes = [
  ["/library", "音乐库", "LIBRARY"],
  ["/playlist/demo-playlist", "歌单", "PLAYLIST"],
  ["/settings", "设置", "SETTINGS"],
] as const;

const routeTrack = {
  id: "demo-track",
  name: "Route Signal",
  artists: [{ id: "route-artist", name: "Echo Form", avatarUrl: null }],
  album: { id: "route-album", name: "Route Record", artworkUrl: null },
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

test.describe.configure({ mode: "serial" });

test("keeps every product route local and explicit", async ({ page }) => {
  await page.setViewportSize(viewports[0]);
  await page.route("**/api/tracks/demo-track", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: routeTrack }),
    });
  });
  await page.route("**/api/tracks/demo-track/lyrics", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { kind: "unavailable", lines: [] } }),
    });
  });
  await page.route("**/api/discovery/new-songs?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] }),
    });
  });
  await page.route("**/api/discovery/popular-playlists?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { items: [], total: 0, limit: 8, offset: 0, hasMore: false },
      }),
    });
  });

  for (const [path, title, context] of productRoutes) {
    const response = await page.goto(path);

    expect(response?.ok()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("模块正在搭建");
    await expect(page.getByRole("navigation", { name: "ECHOFORM 主导航" })).toBeVisible();
    await expect(page.locator("[data-route-context]")).toHaveText(context);
  }

  await page.route("**/api/users/701", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          profile: {
            id: "701",
            nickname: "Route Listener",
            avatarUrl: null,
            signature: null,
          },
          isCurrentUser: false,
          recentPlays: { state: "unavailable", reason: "upstream-not-verified" },
        },
      }),
    });
  });
  await page.route("**/api/users/701/playlists?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { liked: null, created: [], subscribed: [] },
      }),
    });
  });
  const profileResponse = await page.goto("/profile/701");
  expect(profileResponse?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/profile\/701$/);
  await expect(page.getByRole("heading", { level: 1, name: "Route Listener" })).toBeVisible();
  await expect(page.getByText("暂时没有可公开展示的喜欢音乐。")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "ECHOFORM 主导航" })).toBeVisible();
  await expect(page.locator("[data-route-context]")).toHaveText("PROFILE");

  const searchResponse = await page.goto("/search");
  expect(searchResponse?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1, name: "搜索" })).toBeVisible();
  await expect(page.getByLabel("搜索歌曲、歌手或专辑")).toBeVisible();
  await expect(page.getByRole("heading", { name: "暂时没有公开精选" })).toBeVisible();

  const trackResponse = await page.goto("/track/demo-track");
  expect(trackResponse?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/track\/demo-track$/);
  await expect(page.getByRole("heading", { level: 1, name: "Route Signal" })).toBeVisible();
  await expect(page.locator("[data-track-page-state='ready']")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "ECHOFORM 主导航" })).toBeVisible();
  await expect(page.locator("[data-route-context]")).toHaveText("NOW PLAYING");

  const hasVisibleDevToolsButton = await page.locator("nextjs-portal").evaluateAll(
    (portals) => portals.some((portal) => {
      const buttons = portal.shadowRoot?.querySelectorAll("button") ?? [];

      return Array.from(buttons).some((button) => {
        const { height, width } = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return width > 0
          && height > 0
          && style.display !== "none"
          && style.visibility !== "hidden";
      });
    }),
  );
  expect(hasVisibleDevToolsButton).toBe(false);
});

test("keeps navigation clear, reachable, and non-overlapping at three viewports", async ({ page }, testInfo) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/search");

    const topNavigation = page.getByRole("navigation", { name: "ECHOFORM 主导航" });
    const context = page.locator("[data-route-context]");
    const heading = page.getByRole("heading", { level: 1, name: "搜索" });
    const brand = page.getByRole("link", { name: "ECHOFORM 首页" });

    await expect(topNavigation).toBeVisible();
    await expect(heading).toBeVisible();
    await expect(page.getByRole("link", { name: "搜索" })).toBeVisible();
    await expect(page.getByRole("button", { name: "使用网易云音乐登录" })).toBeVisible();
    await expect(page.getByRole("link", { name: "发现" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "音乐库" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "ECHOFORM 移动端主导航" })).toHaveCount(0);

    if (viewport.name === "mobile") {
      await expect(context).toBeHidden();
    } else {
      await expect(context).toBeVisible();
      await expect(context).toHaveText("SEARCH");
    }

    const visibleNavigationLinks = page.locator("nav a:visible");
    const linkCount = await visibleNavigationLinks.count();
    expect(linkCount).toBe(2);

    for (let index = 0; index < linkCount; index += 1) {
      const box = await visibleNavigationLinks.nth(index).boundingBox();
      expect(box, `missing ${viewport.name} navigation link box`).not.toBeNull();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }

    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth).toBeLessThanOrEqual(viewport.width);

    const topBox = await topNavigation.boundingBox();
    const headingBox = await heading.boundingBox();
    expect(topBox).not.toBeNull();
    expect(headingBox).not.toBeNull();
    expect(headingBox?.y ?? 0).toBeGreaterThanOrEqual((topBox?.y ?? 0) + (topBox?.height ?? 0));

    const brandBox = await brand.boundingBox();
    expect(brandBox).not.toBeNull();
    expect(brandBox?.width ?? 0).toBeGreaterThanOrEqual(80);
    expect(["normal", "0px"]).toContain(
      await brand.evaluate((element) => getComputedStyle(element).letterSpacing),
    );
    expect(await brand.evaluate((element) => getComputedStyle(element).transform)).toBe("none");

    await page.screenshot({
      path: testInfo.outputPath(`app-shell-${viewport.name}.png`),
    });
  }
});

test("supports skip navigation and focuses headings after local navigation", async ({ page }) => {
  await page.setViewportSize(viewports[0]);
  await page.goto("/settings");

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "跳到主内容" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main", { name: "ECHOFORM 主内容" })).toBeFocused();

  await page.getByRole("link", { name: "搜索" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole("heading", { level: 1, name: "搜索" })).toBeFocused();
});

test("keeps one persistent audio node across client-side product routes", async ({ page }) => {
  await page.setViewportSize(viewports[0]);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "使用网易云音乐登录" })).toBeVisible();

  const audio = page.locator("[data-echoform-audio]");
  await expect(audio).toHaveCount(1);
  await audio.evaluate((element) => {
    (window as Window & { __echoformAudio?: Element }).__echoformAudio = element;
  });

  await page.getByRole("link", { name: "搜索" }).click();
  await expect(page).toHaveURL(/\/search$/);
  expect(await audio.evaluate((element) => (
    (window as Window & { __echoformAudio?: Element }).__echoformAudio === element
  ))).toBe(true);

  await page.getByRole("link", { name: "ECHOFORM 首页" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await audio.evaluate((element) => (
    (window as Window & { __echoformAudio?: Element }).__echoformAudio === element
  ))).toBe(true);
  await expect(page.locator("[data-player-visible='false']")).toBeHidden();
});

test("keeps the shell usable at 200 percent equivalent zoom and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto("/search");

  await expect(page.getByRole("heading", { level: 1, name: "搜索" })).toBeVisible();
  await expect(page.locator("[data-route-context]")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "ECHOFORM 移动端主导航" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(720);

  const currentLink = page.getByRole("navigation", { name: "ECHOFORM 主导航" })
    .getByRole("link", { name: "搜索" });
  await expect(currentLink).toHaveAttribute("aria-current", "page");
  const reducedDuration = await currentLink.evaluate((element) => {
    const duration = getComputedStyle(element).transitionDuration;
    return duration.endsWith("ms")
      ? Number.parseFloat(duration) / 1000
      : Number.parseFloat(duration);
  });
  expect(reducedDuration).toBeLessThanOrEqual(0.001);
});
