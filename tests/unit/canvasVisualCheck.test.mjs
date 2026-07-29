import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";

import { hasVisibleCanvasContent } from "../../scripts/canvas-visual-check.mjs";

function createSolidPng(width, height, value = 18) {
  const png = new PNG({ width, height });

  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = value;
    png.data[index + 1] = value;
    png.data[index + 2] = value;
    png.data[index + 3] = 255;
  }

  return png;
}

function paintRectangle(png, x, y, width, height, value = 220) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const index = (row * png.width + column) * 4;
      png.data[index] = value;
      png.data[index + 1] = value;
      png.data[index + 2] = value;
    }
  }
}

describe("canvas visual content check", () => {
  it("rejects a completely blank canvas", () => {
    expect(hasVisibleCanvasContent(createSolidPng(1000, 1000))).toBe(false);
  });

  it("rejects a small corner overlay on an otherwise blank canvas", () => {
    const png = createSolidPng(1000, 1000);
    paintRectangle(png, 20, 940, 32, 32);

    expect(hasVisibleCanvasContent(png)).toBe(false);
  });

  it("accepts content occupying a meaningful canvas area", () => {
    const png = createSolidPng(1000, 1000);
    paintRectangle(png, 350, 350, 300, 200);

    expect(hasVisibleCanvasContent(png)).toBe(true);
  });
});
