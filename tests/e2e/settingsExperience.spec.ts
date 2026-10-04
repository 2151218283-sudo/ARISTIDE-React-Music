import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function mockSession(page: Page): Promise<void> {
  await page.route("**/api/auth/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      data: {
        mode: "real",
        user: { id: "settings-user", nickname: "Settings Listener", avatarUrl: null, signature: null },
      },
    }),
  }));
}

function silentWav(): Buffer {
  const sampleRate = 8_000;
  const samples = sampleRate * 30;
  const buffer = Buffer.alloc(44 + samples);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples, 40);
  buffer.fill(128, 44);
  return buffer;
}

test("keeps preferences on reload but clears the active sleep timer", async ({ page }) => {
  await mockSession(page);
  await page.goto("/settings");
  await page.getByRole("radio", { name: "无损" }).check();
  await page.getByRole("switch", { name: /显示翻译/ }).uncheck();
  await page.getByRole("button", { name: "开始计时" }).click();
  await expect(page.getByText(/剩余 15:/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: "无损" })).toBeChecked();
  await expect(page.getByRole("switch", { name: /显示翻译/ })).not.toBeChecked();
  await expect(page.getByText("未设置定时停止")).toBeVisible();
  const saved = await page.evaluate(() => localStorage.getItem("echoform:settings:v1"));
  expect(saved).not.toContain("sleepTimer");
});

test("reports blocked local writes next to the changed control", async ({ page }) => {
  await mockSession(page);
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new Error("Synthetic quota error"); };
  });
  await page.goto("/settings");
  await page.getByRole("radio", { name: "无损" }).check();
  await expect(page.getByRole("radio", { name: "无损" })).toBeChecked();
  await expect(page.locator("#main-content [role='alert']")).toContainText("保存失败");
});

test("keeps user and system reduced-motion requests active after reload", async ({ page }) => {
  await mockSession(page);
  await page.goto("/settings");
  await page.getByRole("switch", { name: /减少动态/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
  await page.reload();
  await expect(page.getByRole("switch", { name: /减少动态/ })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
  await page.getByRole("switch", { name: /减少动态/ }).uncheck();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
});

test("fires an overdue timer when a hidden page resumes", async ({ page }) => {
  await mockSession(page);
  await page.goto("/settings");
  await page.clock.install();
  await page.getByRole("button", { name: "开始计时" }).click();
  await expect(page.getByText(/剩余 15:/)).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(15 * 60 * 1_000 + 1_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("未设置定时停止")).toBeVisible();
});

test("cancels a running timer after a successful logout", async ({ page }) => {
  await mockSession(page);
  await page.route("**/api/auth/logout", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ok: true, data: { mode: "real", user: null } }),
  }));
  await page.goto("/settings");
  await page.getByRole("button", { name: "开始计时" }).click();
  await expect(page.getByText(/剩余 15:/)).toBeVisible();
  await page.getByRole("button", { name: "账号菜单" }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page.getByText("未设置定时停止")).toBeVisible();
  await expect(page.getByRole("button", { name: "使用网易云音乐登录" })).toBeVisible();
});

test("requests saved quality and stops the current track across client navigation", async ({ page }) => {
  await mockSession(page);
  const track = {
    id: "701",
    name: "Timer Signal",
    artists: [{ id: "artist-701", name: "Timer Artist", avatarUrl: null }],
    album: { id: "album-701", name: "Timer Album", artworkUrl: null },
    durationMs: 30_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability: "playable",
    privilege: { fee: 0, maxQuality: "lossless" },
  };
  let requestedQuality: string | null = null;
  await page.route("**/api/tracks/701**", async (route) => {
    const url = new URL(route.request().url());
    const data = url.pathname.endsWith("/lyrics")
      ? { kind: "unavailable", lines: [] }
      : url.pathname.endsWith("/source")
        ? {
          url: "/timer-test.wav", expiresAt: Date.now() + 60_000,
          quality: "standard", codec: "wav", bitrate: null,
          sampleRate: 8_000, sizeBytes: null, corsMode: "anonymous",
        }
        : track;
    if (url.pathname.endsWith("/source")) requestedQuality = url.searchParams.get("quality");
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
  await page.route("**/timer-test.wav", (route) => route.fulfill({
    body: silentWav(), contentType: "audio/wav",
  }));

  await page.goto("/settings");
  await page.getByRole("radio", { name: "无损" }).check();
  await page.goto("/track/701");
  await page.getByRole("button", { name: `播放 ${track.name}` }).click();
  await expect(page.locator("[data-player-visible='true']")).toBeVisible();
  await expect.poll(() => requestedQuality).toBe("lossless");
  const audio = page.locator("[data-echoform-audio]");
  await audio.evaluate((element) => {
    (window as Window & { __timerAudio?: Element }).__timerAudio = element;
  });
  await page.getByRole("button", { name: "账号菜单" }).click();
  await page.getByRole("menuitem", { name: "设置" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  expect(await audio.evaluate((element) => (
    (window as Window & { __timerAudio?: Element }).__timerAudio === element
  ))).toBe(true);
  await page.getByRole("combobox", { name: "停止时间" }).selectOption("end-of-track");
  await page.getByRole("button", { name: "开始计时" }).click();
  await expect(page.getByText(/当前歌曲结束后停止/)).toBeVisible();
  await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).duration))
    .toBeGreaterThan(29);
  await audio.evaluate((element) => {
    const output = element as HTMLAudioElement;
    Object.defineProperty(output, "currentTime", { configurable: true, value: 27.5 });
    output.dispatchEvent(new Event("timeupdate"));
  });
  await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).volume))
    .toBeLessThan(1);
  await page.getByRole("button", { name: "取消" }).click();
  await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).volume))
    .toBe(1);
  await page.getByRole("button", { name: "开始计时" }).click();
  await audio.evaluate((element) => element.dispatchEvent(new Event("ended")));
  await expect(page.getByText("未设置定时停止")).toBeVisible();
  await expect(page.locator("[data-player-visible='true']")).toHaveAttribute("data-state", "paused");
});

test("shows a stable settings form in three viewports and at 200% zoom", async ({ page }, testInfo) => {
  await mockSession(page);
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "定时停止" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`settings-${viewport.name}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "开始计时" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
