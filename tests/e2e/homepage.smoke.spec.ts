import { expect, test } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

test.describe.configure({ mode: "serial" });

test("renders the local homepage without horizontal overflow", async ({ page }, testInfo) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const main = page.getByRole("main", { name: "ECHOFORM 主内容" });
    const gallery = page.getByRole("region", { name: "Project filmstrip" });
    const canvas = page.getByLabel("Interactive project gallery");

    await expect(main).toBeVisible();
    await expect(gallery).toBeVisible();
    await expect(canvas).toBeVisible();

    await expect.poll(async () => canvas.evaluate((element) => {
      const { height, width } = element.getBoundingClientRect();
      return { height, width };
    })).toEqual({ height: viewport.height, width: viewport.width });

    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth).toBeLessThanOrEqual(viewport.width);

    await page.screenshot({
      path: testInfo.outputPath(`homepage-${viewport.name}.png`),
    });

    await page.evaluate(() => {
      const galleryCanvas = document.querySelector(
        'canvas[aria-label="Interactive project gallery"]',
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
