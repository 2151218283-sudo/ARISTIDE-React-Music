const MAX_HUD_TICK_COUNT = 30;
const TICK_GAP = 13;
const TICK_HEIGHT = 23;
const SETTLED_SCALE = 2 / 3;
const SETTLED_TOP = 49;

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
    itemCount: number,
  ): void {
    if (!this.context) {
      return;
    }

    this.context.clearRect(0, 0, this.width, this.height);

    if (this.width < 700) {
      return;
    }

    const tickCount = Math.min(Math.max(itemCount, 0), MAX_HUD_TICK_COUNT);
    if (tickCount === 0) {
      return;
    }

    const scale = SETTLED_SCALE;
    const gap = TICK_GAP * scale;
    const tickHeight = TICK_HEIGHT * scale;
    const tickTop = SETTLED_TOP;
    const span = (tickCount - 1) * gap;
    const centerX = this.width * 0.5;
    const startX = centerX - span * 0.5;

    for (let index = 0; index < tickCount; index += 1) {
      this.context.fillStyle = "rgb(186, 200, 183)";
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
