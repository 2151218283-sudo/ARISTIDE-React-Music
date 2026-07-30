import { expect, test, type Page } from "@playwright/test";

type QrStatus = "waiting" | "scanned" | "authorized" | "expired";

const authenticatedUser = {
  id: "9001",
  nickname: "测试用户",
  avatarUrl: null,
  signature: null,
};

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

function apiSuccess(data: unknown) {
  return { ok: true, data, meta: { requestId: "e2e-auth", mode: "real" } };
}

function apiFailure(code: string) {
  return { ok: false, error: { code, message: "测试错误", retryable: true, requestId: "e2e-auth" } };
}

function createNonScannableImageDataUrl(): string {
  return "data:image/png;base64,dmlzdWFsLXN0YWdlLXBsYWNlaG9sZGVy";
}

async function installAuthMock(page: Page) {
  let loggedIn = false;
  let startFails = false;
  let qrStatus: QrStatus = "waiting";

  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(apiSuccess({
        mode: "real",
        user: loggedIn ? authenticatedUser : null,
      })),
    });
  });
  await page.route("**/api/auth/qr", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    if (startFails) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify(apiFailure("UPSTREAM_UNAVAILABLE")),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(apiSuccess({
        challengeId: "a".repeat(43),
        status: "waiting",
        qrImageDataUrl: createNonScannableImageDataUrl(),
        expiresAt: Date.now() + 60_000,
      })),
    });
  });
  await page.route("**/api/auth/qr/status?**", async (route) => {
    const data = qrStatus === "authorized"
      ? { status: "authorized", user: authenticatedUser }
      : { status: qrStatus, ...(qrStatus === "expired" ? {} : { expiresAt: Date.now() + 60_000 }) };
    if (qrStatus === "authorized") {
      loggedIn = true;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(apiSuccess(data)),
    });
  });
  await page.route("**/api/auth/logout", async (route) => {
    loggedIn = false;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(apiSuccess({ mode: "real", user: null })),
    });
  });

  return {
    setQrStatus(status: QrStatus) {
      qrStatus = status;
    },
    setStartFails(value: boolean) {
      startFails = value;
    },
  };
}

test.describe.configure({ mode: "serial" });

test("keeps QR login visible, sharp, keyboard-operable, and stable at three viewports", async ({ page }, testInfo) => {
  const auth = await installAuthMock(page);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "使用网易云音乐登录" });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = page.locator("[role='dialog']");
    const stage = page.getByTestId("qr-stage");
    await expect(page.getByRole("dialog", { name: "使用网易云音乐扫码" })).toBeVisible();
    await expect(dialog).toHaveAttribute("data-auth-phase", "waiting");
    await expect(stage.getByRole("img")).toHaveAttribute(
      "alt",
      "请使用网易云音乐扫描此登录二维码",
    );
    const waitingBox = await stage.boundingBox();
    expect(waitingBox).not.toBeNull();
    expect(await stage.evaluate((element) => getComputedStyle(element).width)).toBe("280px");
    expect(await stage.evaluate((element) => getComputedStyle(element).height)).toBe("280px");

    auth.setQrStatus("scanned");
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(dialog).toHaveAttribute("data-auth-phase", "scanned");
    const scannedBox = await stage.boundingBox();
    expect(scannedBox).not.toBeNull();
    expect(await stage.evaluate((element) => getComputedStyle(element).width)).toBe("280px");
    expect(await stage.evaluate((element) => getComputedStyle(element).height)).toBe("280px");

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`auth-${viewport.name}.png`) });
  }
});

test("renders recovery states, replaces the account entry after authorization, and logs out locally", async ({ page }) => {
  const auth = await installAuthMock(page);
  auth.setStartFails(true);
  await page.goto("/");
  await page.getByRole("button", { name: "使用网易云音乐登录" }).click();
  const dialog = page.locator("[role='dialog']");
  await expect(page.getByRole("dialog", { name: "无法连接登录服务" })).toBeVisible();
  await expect(dialog).toHaveAttribute("data-auth-phase", "error");

  auth.setStartFails(false);
  await page.getByRole("button", { name: "重试" }).click();
  await expect(dialog).toHaveAttribute("data-auth-phase", "waiting");

  auth.setQrStatus("expired");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(dialog).toHaveAttribute("data-auth-phase", "expired");
  await expect(page.getByRole("button", { name: "刷新二维码" })).toBeVisible();

  auth.setQrStatus("authorized");
  await page.getByRole("button", { name: "刷新二维码" }).click();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(dialog).toHaveAttribute("data-auth-phase", "authorized");
  const avatar = page.getByRole("link", { name: "测试用户的个人主页" });
  await expect(avatar).toBeVisible({ timeout: 1_000 });
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "账号菜单" }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page.getByRole("button", { name: "使用网易云音乐登录" })).toBeVisible();
});
