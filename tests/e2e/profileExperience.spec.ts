import { expect, test, type Page, type Route } from "@playwright/test";

const profile = {
  id: "701",
  nickname: "Profile Listener",
  avatarUrl: null,
  signature: "Synthetic profile signature.",
};

const overview = {
  profile,
  isCurrentUser: false,
  recentPlays: { state: "unavailable", reason: "upstream-not-verified" },
};

const collection = {
  liked: {
    id: "801",
    name: "Liked Signals",
    description: null,
    artworkUrl: null,
    owner: profile,
    visibility: "public",
    trackCount: 3,
    createdAt: null,
    updatedAt: null,
  },
  created: [{
    id: "802",
    name: "Created Signals",
    description: null,
    artworkUrl: null,
    owner: profile,
    visibility: "public",
    trackCount: 2,
    createdAt: null,
    updatedAt: null,
  }],
  subscribed: [],
};

function success(data: unknown): string {
  return JSON.stringify({ ok: true, data });
}

function failure(code: string, message: string, retryable: boolean): string {
  return JSON.stringify({
    ok: false,
    error: { code, message, retryable, requestId: "profile-e2e" },
  });
}

async function fulfillJson(route: Route, body: string, status = 200): Promise<void> {
  await route.fulfill({ body, contentType: "application/json", status });
}

async function installProfileRoutes(
  page: Page,
  options: {
    collectionBody?: string;
    collectionStatus?: number;
    overviewGate?: Promise<void>;
    overviewBody?: string;
    overviewStatus?: number;
    sessionUser?: typeof profile | null;
  } = {},
): Promise<void> {
  await page.route("**/api/auth/session", async (route) => {
    await fulfillJson(route, success({ mode: "real", user: options.sessionUser ?? null }));
  });
  await page.route("**/api/recommendations/daily", async (route) => {
    await fulfillJson(route, success({ date: "2026-08-05", source: "public", tracks: [] }));
  });
  await page.route("**/api/users/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/playlists")) {
      await fulfillJson(
        route,
        options.collectionBody ?? success(collection),
        options.collectionStatus ?? 200,
      );
      return;
    }
    if (options.overviewGate) {
      await options.overviewGate;
    }
    await fulfillJson(
      route,
      options.overviewBody ?? success(overview),
      options.overviewStatus ?? 200,
    );
  });
}

test.describe.configure({ mode: "serial" });

test("renders a local public profile at desktop, tablet, and mobile sizes without horizontal overflow", async ({ page }, testInfo) => {
  await installProfileRoutes(page);

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto("/profile/701");
    await expect(page.getByRole("heading", { name: "Profile Listener" })).toBeVisible();
    await expect(page.getByRole("link", { name: "查看歌单 Liked Signals" }))
      .toHaveAttribute("href", "/playlist/801");
    await expect(page.getByText("当前上游读取契约尚未验证，因此未展示任何播放记录。")).toBeVisible();
    await expect(page.getByRole("link", { name: "打开个人设置" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`profile-${viewport.name}.png`) });
  }
});

test("covers loading, empty, protected, missing, upstream-error, and avatar-failure profile states", async ({ page }) => {
  let releaseLoadingOverview = (): void => {};
  const loadingOverviewGate = new Promise<void>((resolve) => {
    releaseLoadingOverview = resolve;
  });
  await installProfileRoutes(page, { sessionUser: profile });
  await page.unroute("**/api/users/**");
  await page.route("**/api/users/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/playlists")) {
      await fulfillJson(route, success({ liked: null, created: [], subscribed: [] }));
      return;
    }
    await loadingOverviewGate;
    await fulfillJson(route, success(overview));
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Profile Listener的个人主页" }).click();
  await expect(page).toHaveURL(/\/profile\/701$/);
  await expect(page.getByRole("status", { name: "正在加载用户主页" })).toBeVisible();
  releaseLoadingOverview();
  await expect(page.getByRole("heading", { name: "Profile Listener" })).toBeVisible();
  await expect(page.getByText("暂时没有可公开展示的喜欢音乐。")).toBeVisible();

  await page.unroute("**/api/users/**");
  await page.route("**/api/users/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/playlists")) {
      await fulfillJson(route, failure("AUTH_REQUIRED", "Synthetic protected collection.", false), 401);
      return;
    }
    await fulfillJson(route, success(overview));
  });
  await page.goto("/profile/701");
  await expect(page.getByRole("heading", { name: "Profile Listener" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "歌单未公开" })).toBeVisible();

  await page.unroute("**/api/users/**");
  await page.route("**/api/users/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/playlists")) {
      await fulfillJson(route, success(collection));
      return;
    }
    await fulfillJson(route, failure("USER_NOT_FOUND", "Synthetic missing user.", false), 404);
  });
  await page.goto("/profile/999");
  await expect(page.getByRole("heading", { name: "未找到用户" })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回首页" })).toBeVisible();

  await page.unroute("**/api/users/**");
  await page.route("**/api/users/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/playlists")) {
      await fulfillJson(route, success(collection));
      return;
    }
    await fulfillJson(route, failure("UPSTREAM_UNAVAILABLE", "Synthetic upstream failure.", true), 502);
  });
  await page.goto("/profile/701");
  await expect(page.getByRole("heading", { name: "无法加载用户主页" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();

  await page.unroute("**/api/users/**");
  await page.route("**/api/users/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/playlists")) {
      await fulfillJson(route, success(collection));
      return;
    }
    await fulfillJson(route, success({
      ...overview,
      profile: { ...profile, avatarUrl: "http://profile.test/profile-failure.png" },
    }));
  });
  await page.route("**/profile-failure.png", async (route) => {
    await route.fulfill({ status: 404, body: "" });
  });
  await page.goto("/profile/701");
  const profileMain = page.getByRole("main", { name: "ECHOFORM 主内容" });
  await expect(profileMain.getByLabel("Profile Listener的头像加载失败")).toBeVisible();
});

test("starts and completes the avatar clone before a delayed profile BFF response", async ({ page }) => {
  let releaseOverview = (): void => {};
  const overviewGate = new Promise<void>((resolve) => {
    releaseOverview = resolve;
  });
  await installProfileRoutes(page, {
    overviewGate,
    sessionUser: profile,
  });

  await page.goto("/");
  await page.getByRole("link", { name: "Profile Listener的个人主页" }).click();
  await expect(page).toHaveURL(/\/profile\/701$/);

  const target = page.locator("[data-profile-header-avatar]");
  await expect(target).toHaveCount(1);
  const cloneExistsWithinTwoFrames = await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return document.querySelector("[data-profile-avatar-transition-clone]") !== null;
  });
  expect(cloneExistsWithinTwoFrames).toBe(true);
  await expect(target).toHaveAttribute("data-profile-avatar-transition-hidden", "true");

  await page.waitForTimeout(1000);
  await expect(page.locator("[data-profile-avatar-transition-clone]")).toHaveCount(0);
  await expect(target).not.toHaveAttribute("data-profile-avatar-transition-hidden");
  await expect(page.getByRole("heading", { name: "Profile Listener" })).toHaveCount(0);

  releaseOverview();
  await expect(page.getByRole("heading", { name: "Profile Listener" })).toBeVisible();
});

test("shows the current-user entry, cancels the shared avatar movement, and respects Reduced Motion", async ({ page }) => {
  await installProfileRoutes(page, {
    overviewBody: success({ ...overview, isCurrentUser: true }),
    sessionUser: profile,
  });
  await page.goto("/");
  const avatar = page.getByRole("link", { name: "Profile Listener的个人主页" });
  await expect(avatar).toBeVisible();
  await avatar.click();
  await expect(page).toHaveURL(/\/profile\/701$/);
  await expect(page.getByRole("heading", { name: "Profile Listener" })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开个人设置" })).toHaveAttribute("href", "/settings");
  await expect(page.locator("[data-profile-avatar-transition-clone][data-running='true']")).toBeVisible();
  await page.mouse.wheel(0, 30);
  await expect(page.locator("[data-profile-avatar-transition-clone]")).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("link", { name: "Profile Listener的个人主页" }).click();
  await expect(page.getByRole("heading", { name: "Profile Listener" })).toBeVisible();
  await expect(page.locator("[data-profile-avatar-transition-clone]")).toHaveCount(0);
});
