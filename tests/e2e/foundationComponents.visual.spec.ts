import react from "@vitejs/plugin-react";
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";

const previewPort = 3101;
const previewUrl = `http://127.0.0.1:${previewPort}/tests/e2e/foundation-preview.html`;
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

function contrastRatio(foreground: string, background: string): number {
  const toLuminance = (color: string) => {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);

    if (!channels || channels.length !== 3) {
      throw new Error(`Unable to parse computed color: ${color}`);
    }

    const [red, green, blue] = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const foregroundLuminance = toLuminance(foreground);
  const backgroundLuminance = toLuminance(background);
  const light = Math.max(foregroundLuminance, backgroundLuminance);
  const dark = Math.min(foregroundLuminance, backgroundLuminance);

  return (light + 0.05) / (dark + 0.05);
}

let previewServer: ViteDevServer;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  previewServer = await createServer({
    appType: "mpa",
    logLevel: "error",
    plugins: [react()],
    resolve: {
      alias: {
        "next/image": resolve(process.cwd(), "tests/e2e/nextImageMock.tsx"),
      },
    },
    root: process.cwd(),
    server: {
      host: "127.0.0.1",
      port: previewPort,
      strictPort: true,
    },
  });
  await previewServer.listen();
});

test.afterAll(async () => {
  await previewServer.close();
});

test("keeps foundation components stable across themes, viewports, and zoom", async ({
  page,
}, testInfo) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(previewUrl);
    await expect(page.locator("[data-preview-root]")).toBeVisible();

    for (const theme of ["ink", "paper", "artwork"] as const) {
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.theme = nextTheme;
      }, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      const computedTheme = await page.evaluate(() => {
        const preview = document.querySelector<HTMLElement>("[data-preview-root]");
        const secondaryText = document.querySelector<HTMLElement>("[data-secondary-text]");

        if (!preview || !secondaryText) {
          throw new Error("Foundation preview theme probes are missing.");
        }

        const previewStyle = getComputedStyle(preview);

        return {
          background: previewStyle.backgroundColor,
          colorScheme: getComputedStyle(document.documentElement).colorScheme,
          primary: previewStyle.color,
          secondary: getComputedStyle(secondaryText).color,
        };
      });

      expect(computedTheme.colorScheme).toBe(theme === "paper" ? "light" : "dark");
      expect(contrastRatio(computedTheme.primary, computedTheme.background))
        .toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(computedTheme.secondary, computedTheme.background))
        .toBeGreaterThanOrEqual(4.5);

      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`foundation-${theme}-${viewport.name}.png`),
      });
    }

    const defaultButtonBox = await page.locator('[data-stable-button="default"]').boundingBox();
    const loadingButtonBox = await page.locator('[data-stable-button="loading"]').boundingBox();

    expect(defaultButtonBox).not.toBeNull();
    expect(loadingButtonBox).not.toBeNull();
    expect(Math.abs((defaultButtonBox?.width ?? 0) - (loadingButtonBox?.width ?? 0)))
      .toBeLessThanOrEqual(0.5);
    expect(Math.abs((defaultButtonBox?.height ?? 0) - (loadingButtonBox?.height ?? 0)))
      .toBeLessThanOrEqual(0.5);

    const touchTargets = page.locator("[data-touch-target], button[data-status]");
    const targetCount = await touchTargets.count();

    for (let index = 0; index < targetCount; index += 1) {
      const box = await touchTargets.nth(index).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    if (viewport.name === "mobile") {
      const textTargets = page.locator("[data-text-target]");
      const textTargetCount = await textTargets.count();

      for (let index = 0; index < textTargetCount; index += 1) {
        const box = await textTargets.nth(index).boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
    }

    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewport.width);

    const zoomViewport = {
      width: Math.ceil(viewport.width / 2),
      height: Math.ceil(viewport.height / 2),
    };
    await page.setViewportSize(zoomViewport);
    const zoomDocumentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(zoomDocumentWidth).toBeLessThanOrEqual(zoomViewport.width);
  }
});

test("renders loading surfaces without motion when reduced motion is requested", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(previewUrl);

  const animationNames = await page.evaluate(() => {
    const loadingControl = document.querySelector("[data-loading-control] span span");
    const artworkLoading = document.querySelector('[data-status="loading"] > span');
    const skeleton = document.querySelector('[data-variant="artwork"]');

    return [loadingControl, artworkLoading, skeleton].map((element) => (
      element ? getComputedStyle(element).animationName : "missing"
    ));
  });

  expect(animationNames).toEqual(["none", "none", "none"]);
});
