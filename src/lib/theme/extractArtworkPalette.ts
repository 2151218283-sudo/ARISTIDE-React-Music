import { deriveArtworkPalette, type ArtworkPalette } from "./artworkPalette";

const sampleSize = 32;

export function extractArtworkPalette(
  url: string,
  signal: AbortSignal,
  timeoutMs = 4_000,
): Promise<ArtworkPalette | null> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }
    const image = new Image();
    let settled = false;
    const finish = (palette: ArtworkPalette | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
      if (palette === null || signal.aborted) image.removeAttribute("src");
      resolve(palette);
    };
    const abort = (): void => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onerror = () => finish(null);
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          finish(null);
          return;
        }
        context.drawImage(image, 0, 0, sampleSize, sampleSize);
        finish(deriveArtworkPalette(context.getImageData(0, 0, sampleSize, sampleSize).data));
      } catch {
        finish(null);
      }
    };
    image.src = url;
  });
}
