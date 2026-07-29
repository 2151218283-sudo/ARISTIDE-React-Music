const HUD_TICK_COUNT = 30;
const TICK_GAP = 13;
const TICK_HEIGHT = 23;
const TICK_TOP = 72;
const SETTLED_SCALE = 2 / 3;
const SETTLED_TOP = 49;

function mix(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

export class GalleryHud {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = Math.max(1, Math.round(width * pixelRatio));
    this.canvas.height = Math.max(1, Math.round(height * pixelRatio));
    this.context?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  draw(
    activeIndex: number,
    color = "rgb(186, 196, 184)",
    overviewProgress = 0,
  ): void {
    if (!this.context) {
      return;
    }

    this.context.clearRect(0, 0, this.width, this.height);

    if (this.width < 700) {
      return;
    }

    const scale = mix(1, SETTLED_SCALE, overviewProgress);
    const gap = TICK_GAP * scale;
    const tickHeight = TICK_HEIGHT * scale;
    const tickTop = mix(TICK_TOP, SETTLED_TOP, overviewProgress);
    const span = (HUD_TICK_COUNT - 1) * gap;
    const centerX = mix(this.width * 0.755, this.width * 0.5, overviewProgress);
    const startX = centerX - span * 0.5;

    for (let index = 0; index < HUD_TICK_COUNT; index += 1) {
      this.context.fillStyle = color;
      this.context.globalAlpha = index === activeIndex ? 0.42 : 0.18;
      this.context.fillRect(
        Math.round(startX + index * gap),
        tickTop,
        1,
        tickHeight,
      );
    }

    this.context.globalAlpha = 1;
  }
}
