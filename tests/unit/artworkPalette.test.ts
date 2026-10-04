import { describe, expect, it } from "vitest";

import {
  deriveArtworkPalette,
  palettePassesContrast,
} from "../../src/lib/theme/artworkPalette";

function pixels(color: [number, number, number, number], count = 1024): Uint8ClampedArray {
  return new Uint8ClampedArray(Array.from({ length: count }, () => color).flat());
}

describe("artwork palette", () => {
  it.each([
    ["vivid red", [245, 27, 58, 255]],
    ["saturated blue", [27, 82, 238, 255]],
    ["deep green", [8, 68, 43, 255]],
    ["bright yellow", [249, 230, 45, 255]],
  ] as const)("constrains %s and keeps every surface and control readable", (_, color) => {
    const palette = deriveArtworkPalette(pixels([...color]));
    expect(palette).not.toBeNull();
    expect(palettePassesContrast(palette!)).toBe(true);
    expect(palette!.surface).not.toBe(palette!.primary);
  });

  it("ignores transparent and rare extreme pixels", () => {
    const image = pixels([24, 160, 122, 255], 900);
    const combined = new Uint8ClampedArray(image.length + 124 * 4);
    combined.set(image);
    for (let index = image.length; index < combined.length; index += 4) {
      combined.set(index % 8 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0], index);
    }
    const palette = deriveArtworkPalette(combined);
    expect(palette).not.toBeNull();
    expect(palettePassesContrast(palette!)).toBe(true);
  });

  it.each([
    ["transparent", [120, 50, 220, 0]],
    ["near black", [4, 4, 4, 255]],
    ["near white", [251, 251, 251, 255]],
    ["neutral", [125, 125, 125, 255]],
  ] as const)("returns INK fallback input for %s", (_, color) => {
    expect(deriveArtworkPalette(pixels([...color]))).toBeNull();
  });

  it("rejects an empty or malformed pixel buffer", () => {
    expect(deriveArtworkPalette(new Uint8ClampedArray())).toBeNull();
    expect(deriveArtworkPalette(new Uint8ClampedArray([1, 2, 3]))).toBeNull();
  });
});
