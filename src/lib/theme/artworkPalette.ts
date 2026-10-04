export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface ArtworkPalette {
  primary: string;
  secondary: string;
  surface: string;
  raised: string;
  overlay: string;
  onSurface: string;
  onSurfaceMuted: string;
  onPrimary: string;
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

function toHex(color: RgbColor): string {
  return `#${[color.r, color.g, color.b]
    .map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function fromHex(value: string): RgbColor {
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

function luminance(color: RgbColor): number {
  const channels = [color.r, color.g, color.b].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(left: RgbColor, right: RgbColor): number {
  const first = luminance(left);
  const second = luminance(right);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function mix(left: RgbColor, right: RgbColor, rightWeight: number): RgbColor {
  return {
    r: left.r * (1 - rightWeight) + right.r * rightWeight,
    g: left.g * (1 - rightWeight) + right.g * rightWeight,
    b: left.b * (1 - rightWeight) + right.b * rightWeight,
  };
}

function toHsl(color: RgbColor): { h: number; s: number; l: number } {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / delta) % 6
    : max === g ? (b - r) / delta + 2
      : (r - g) / delta + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

function fromHsl(h: number, s: number, l: number): RgbColor {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = ((h % 360) + 360) % 360 / 60;
  const x = chroma * (1 - Math.abs(segment % 2 - 1));
  const [r, g, b] = segment < 1 ? [chroma, x, 0]
    : segment < 2 ? [x, chroma, 0]
      : segment < 3 ? [0, chroma, x]
        : segment < 4 ? [0, x, chroma]
          : segment < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const offset = l - chroma / 2;
  return { r: (r + offset) * 255, g: (g + offset) * 255, b: (b + offset) * 255 };
}

interface HueBucket {
  count: number;
  hueX: number;
  hueY: number;
  saturation: number;
}

export function deriveArtworkPalette(pixels: Uint8ClampedArray): ArtworkPalette | null {
  if (pixels.length === 0 || pixels.length % 4 !== 0) return null;
  const buckets = Array.from({ length: 12 }, (): HueBucket => ({
    count: 0, hueX: 0, hueY: 0, saturation: 0,
  }));

  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 192) continue;
    const color = toHsl({ r: pixels[index], g: pixels[index + 1], b: pixels[index + 2] });
    if (color.l < 0.06 || color.l > 0.94 || color.s < 0.12) continue;
    const bucket = buckets[Math.floor(color.h / 30) % buckets.length];
    bucket.count += 1;
    bucket.hueX += Math.cos(color.h * Math.PI / 180);
    bucket.hueY += Math.sin(color.h * Math.PI / 180);
    bucket.saturation += color.s;
  }

  const ranked = buckets.filter((bucket) => bucket.count > 0)
    .sort((left, right) => right.count - left.count);
  if (ranked.length === 0) return null;
  const hueFor = (bucket: HueBucket) => (
    (Math.atan2(bucket.hueY, bucket.hueX) * 180 / Math.PI + 360) % 360
  );
  const primaryHue = hueFor(ranked[0]);
  const primarySaturation = ranked[0].saturation / ranked[0].count;
  const secondaryHue = ranked.find((bucket) => {
    const distance = Math.abs(hueFor(bucket) - primaryHue);
    return Math.min(distance, 360 - distance) >= 45;
  });

  const surface = fromHsl(primaryHue, clamp(primarySaturation * 0.32, 0.1, 0.25), 0.17);
  const raised = mix(surface, { r: 255, g: 255, b: 255 }, 0.045);
  const overlay = mix(surface, { r: 255, g: 255, b: 255 }, 0.08);
  const primary = fromHsl(primaryHue, clamp(primarySaturation, 0.35, 0.65), 0.72);
  const secondary = fromHsl(secondaryHue ? hueFor(secondaryHue) : primaryHue, 0.4, 0.78);
  const onSurface = fromHex("#f2f4f0");
  const onSurfaceMuted = fromHex("#cdd4cb");
  const onPrimary = fromHex("#0c0d0d");

  if ([surface, raised, overlay].some((background) => (
    contrastRatio(onSurface, background) < 4.5
    || contrastRatio(onSurfaceMuted, background) < 4.5
    || contrastRatio(primary, background) < 3
    || contrastRatio(secondary, background) < 3
  )) || contrastRatio(onPrimary, primary) < 4.5) return null;

  return {
    primary: toHex(primary), secondary: toHex(secondary), surface: toHex(surface),
    raised: toHex(raised), overlay: toHex(overlay), onSurface: toHex(onSurface),
    onSurfaceMuted: toHex(onSurfaceMuted), onPrimary: toHex(onPrimary),
  };
}

export function palettePassesContrast(palette: ArtworkPalette): boolean {
  const surfaces = [palette.surface, palette.raised, palette.overlay].map(fromHex);
  return surfaces.every((surface) => (
    contrastRatio(fromHex(palette.onSurface), surface) >= 4.5
    && contrastRatio(fromHex(palette.onSurfaceMuted), surface) >= 4.5
    && contrastRatio(fromHex(palette.primary), surface) >= 3
    && contrastRatio(fromHex(palette.secondary), surface) >= 3
  )) && contrastRatio(fromHex(palette.onPrimary), fromHex(palette.primary)) >= 4.5;
}
