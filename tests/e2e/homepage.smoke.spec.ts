import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const tracks = [
  {
    id: "gallery-001",
    name: "Measured Light",
    artists: [{ id: "artist-001", name: "Echo Form", avatarUrl: null }],
    album: { id: "album-001", name: "Reference", artworkUrl: null },
    durationMs: 180_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability: "playable",
    privilege: { fee: 0, maxQuality: null },
  },
  {
    id: "gallery-002",
    name: "Finite Horizon",
    artists: [{ id: "artist-002", name: "Signal Bloom", avatarUrl: null }],
    album: { id: "album-002", name: "Reference II", artworkUrl: null },
    durationMs: 192_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability: "playable",
    privilege: { fee: 0, maxQuality: null },
  },
  {
    id: "gallery-003",
    name: "Last Centre",
    artists: [{ id: "artist-003", name: "Quiet Form", avatarUrl: null }],
    album: { id: "album-003", name: "Reference III", artworkUrl: null },
    durationMs: 201_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability: "playable",
    privilege: { fee: 0, maxQuality: null },
  },
];

async function installGalleryRoutes(page: Page) {
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { mode: "real", user: null } }),
    });
  });
  await page.route("**/api/recommendations/daily", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { date: "2026-07-31", source: "public", tracks },
      }),
    });
  });
}

test.describe.configure({ mode: "serial" });

test("renders the local homepage without horizontal overflow", async ({ page }, testInfo) => {
  await installGalleryRoutes(page);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const main = page.getByRole("main", { name: "ECHOFORM 主内容" });
    const gallery = page.getByRole("region", { name: "Daily track gallery" });
    const canvas = page.getByLabel("Interactive daily track gallery");

    await expect(main).toBeVisible();
    await expect(gallery).toBeVisible();
    await expect(canvas).toBeVisible();

    await expect.poll(async () => canvas.evaluate((element) => {
      const { height, width } = element.getBoundingClientRect();
      return { height, width };
    })).toEqual({ height: viewport.height, width: viewport.width });
    await expect.poll(async () => canvas.evaluate((element) => {
      if (!(element instanceof HTMLCanvasElement)) {
        return false;
      }

      const context = element.getContext("webgl2") ?? element.getContext("webgl");

      if (!context || context.isContextLost() || element.width === 0 || element.height === 0) {
        return false;
      }

      const pixels = new Uint8Array(element.width * element.height * 4);
      context.readPixels(
        0,
        0,
        element.width,
        element.height,
        context.RGBA,
        context.UNSIGNED_BYTE,
        pixels,
      );

      const requiredChangedPixelCount = Math.max(
        64,
        Math.ceil(element.width * element.height * 0.005),
      );
      let changedPixelCount = 0;

      for (let index = 0; index < pixels.length; index += 4) {
        const changed = Math.abs(pixels[index] - 20) > 8
          || Math.abs(pixels[index + 1] - 20) > 8
          || Math.abs(pixels[index + 2] - 20) > 8
          || pixels[index + 3] !== 255;

        if (changed) {
          changedPixelCount += 1;

          if (changedPixelCount >= requiredChangedPixelCount) {
            return true;
          }
        }
      }

      return false;
    })).toBe(true);

    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth).toBeLessThanOrEqual(viewport.width);

    await page.screenshot({
      path: testInfo.outputPath(`homepage-${viewport.name}.png`),
    });

    await page.evaluate(() => {
      const galleryCanvas = document.querySelector(
        'canvas[aria-label="Interactive daily track gallery"]',
      );

      if (!(galleryCanvas instanceof HTMLCanvasElement)) {
        throw new Error("The interactive gallery canvas is missing.");
      }

      for (const element of document.body.querySelectorAll("*")) {
        if (element !== galleryCanvas && !element.contains(galleryCanvas)) {
          element.setAttribute("data-e2e-canvas-hidden", "true");
        }
      }
    });
    await page.addStyleTag({
      content: `
        [data-e2e-canvas-hidden="true"] {
          visibility: hidden !important;
        }
      `,
    });
    await canvas.screenshot({
      path: testInfo.outputPath(`canvas-${viewport.name}.png`),
    });
  }
});
