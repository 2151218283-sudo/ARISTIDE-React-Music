// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractArtworkPalette } from "../../src/lib/theme/extractArtworkPalette";

const images: MockImage[] = [];

class MockImage {
  crossOrigin = "";
  decoding = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  removed = false;
  src = "";

  constructor() {
    images.push(this);
  }

  removeAttribute(name: string): void {
    if (name === "src") {
      this.removed = true;
      this.src = "";
    }
  }
}

beforeEach(() => {
  images.length = 0;
  vi.stubGlobal("Image", MockImage);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("artwork image extraction", () => {
  it("cancels a stalled anonymous image at its deadline", async () => {
    vi.useFakeTimers();
    const result = extractArtworkPalette("/stalled.png", new AbortController().signal, 40);
    expect(images[0].crossOrigin).toBe("anonymous");
    expect(images[0].src).toBe("/stalled.png");
    await vi.advanceTimersByTimeAsync(40);
    await expect(result).resolves.toBeNull();
    expect(images[0].removed).toBe(true);
  });

  it("cancels an obsolete image without waiting for its deadline", async () => {
    const controller = new AbortController();
    const result = extractArtworkPalette("/old.png", controller.signal);
    controller.abort();
    await expect(result).resolves.toBeNull();
    expect(images[0].removed).toBe(true);
  });

  it("falls back when a cross-origin canvas cannot be read", async () => {
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((name, options) => {
      if (name !== "canvas") return originalCreateElement(name, options);
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => { throw new DOMException("Tainted canvas", "SecurityError"); },
        }),
      } as unknown as HTMLCanvasElement;
    });
    const result = extractArtworkPalette("https://example.invalid/cover.png", new AbortController().signal);
    images[0].onload?.();
    await expect(result).resolves.toBeNull();
    expect(images[0].removed).toBe(true);
  });
});
