import * as THREE from "three";

import type { Track } from "@/lib/music/models";

import { GalleryHud } from "./galleryHud";
import {
  filmstripFragmentShader,
  filmstripVertexShader,
} from "./filmstripShaders";

const BACKGROUND_COLOR = 0x0c0d0d;
const INACTIVE_BRIGHTNESS = 0.55;
const HOVER_BRIGHTNESS = 0.9;
const WHEEL_DAMPING = 0.08;
const MAX_WHEEL_CONTRIBUTION = 140;
const OFFSET_EPSILON = 0.05;
const WAVE_FULL_SPEED = 900;
const WAVE_SCALE_AMPLITUDE = 0.27;
const WAVE_VERTICAL_TRAVEL = 22;
const WAVE_ROTATION = THREE.MathUtils.degToRad(4);
const PREVIEW_ENTRY_DURATION = 1100;
const PREVIEW_EXIT_DURATION = 500;
const TEXTURE_WINDOW_RADIUS = 3;
const CONSTRAINED_PIXEL_RATIO = 1.25;
const FULL_PIXEL_RATIO = 2;
const CONSTRAINED_MAX_ANISOTROPY = 2;
const FULL_MAX_ANISOTROPY = 8;
const POINTER_SETTLE_EPSILON = 0.001;

type GalleryQuality = "constrained" | "full";
type GalleryRenderState = "hidden" | "idle" | "interacting" | "previewing" | "settling";

type FilmMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

interface FilmItem {
  brightness: number;
  fallbackTexture: THREE.Texture;
  material: THREE.ShaderMaterial;
  mesh: FilmMesh;
  pendingTexture: THREE.Texture | null;
  remoteTexture: THREE.Texture | null;
  saturation: number;
  texture: THREE.Texture;
  track: Track;
  textureLoadGeneration: number;
  textureFailed: boolean;
}

interface GalleryLayout {
  gap: number;
  height: number;
  originLeft: number;
  planeHeight: number;
  planeWidth: number;
  stride: number;
  totalWidth: number;
  width: number;
  worldCenterY: number;
}

interface PreviewLayout {
  centerX: number;
  centerY: number;
  size: number;
}

interface FilmstripSceneOptions {
  canvas: HTMLCanvasElement;
  hudCanvas: HTMLCanvasElement;
  onCurrentTrackChange: (track: Track) => void;
  onSelect: (track: Track) => void;
  onTextureError: (track: Track) => void;
  tracks: readonly Track[];
}

function frameDamping(amountAtSixtyFps: number, deltaSeconds: number): number {
  return 1 - Math.pow(1 - amountAtSixtyFps, deltaSeconds * 60);
}

function calculateLayout(width: number, height: number, itemCount: number): GalleryLayout {
  let planeWidth = width * 0.078;
  let planeHeight = height * 0.463;
  let gap = width * 0.016;

  if (width < 700) {
    planeWidth = 35;
    planeHeight = height * 0.162;
    gap = 7;
  } else if (width < 1150) {
    planeWidth = width * 0.095;
    planeHeight = height * 0.26;
    gap = width * 0.018;
  }

  const stride = planeWidth + gap;

  return {
    gap,
    height,
    originLeft: (width - planeWidth) * 0.5,
    planeHeight,
    planeWidth,
    stride,
    totalWidth: stride * itemCount,
    width,
    worldCenterY: 0,
  };
}

function calculatePreviewLayout(width: number, height: number): PreviewLayout {
  if (width < 700) {
    return {
      centerX: 0,
      centerY: height * 0.21,
      size: Math.min(width - 48, height * 0.34, 340),
    };
  }

  if (width < 1150) {
    return {
      centerX: width * -0.22,
      centerY: 0,
      size: Math.min(width * 0.46, height * 0.42, 440),
    };
  }

  return {
    centerX: width * -0.18,
    centerY: 0,
    size: Math.min(width * 0.37, height * 0.56, 520),
  };
}

function easeOutQuint(progress: number): number {
  return 1 - Math.pow(1 - progress, 5);
}

function easeInOutCubic(progress: number): number {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function getWheelPixels(event: WheelEvent, viewportHeight: number): number {
  const primaryDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ? event.deltaX
    : event.deltaY;

  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return primaryDelta * 16;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return primaryDelta * viewportHeight;
  }

  return primaryDelta;
}

function trackInitials(track: Track): string {
  const source = track.name.trim() || track.artists[0]?.name.trim() || "E";
  return Array.from(source).slice(0, 2).join("").toUpperCase();
}

function createFallbackTexture(track: Track): THREE.Texture {
  const artwork = document.createElement("canvas");
  artwork.width = 512;
  artwork.height = 512;
  const context = artwork.getContext("2d");

  if (!context) {
    const pixels = new Uint8Array([36, 39, 37, 255]);
    const texture = new THREE.DataTexture(pixels, 1, 1, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
  }

  context.fillStyle = "rgb(36, 39, 37)";
  context.fillRect(0, 0, artwork.width, artwork.height);
  context.strokeStyle = "rgb(142, 145, 139)";
  context.lineWidth = 2;
  context.strokeRect(32, 32, artwork.width - 64, artwork.height - 64);
  context.fillStyle = "rgb(218, 220, 214)";
  context.font = "600 150px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(trackInitials(track), artwork.width / 2, artwork.height / 2);

  return new THREE.CanvasTexture(artwork);
}

function resolveGalleryQuality(): GalleryQuality {
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  const deviceMemory = navigatorWithMemory.deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;

  return window.matchMedia("(max-width: 699px)").matches || deviceMemory <= 4 || cores <= 4
    ? "constrained"
    : "full";
}

export class FilmstripScene {
  private readonly background = new THREE.Color(BACKGROUND_COLOR);
  private readonly camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 2000);
  private readonly canvas: HTMLCanvasElement;
  private readonly filmGroup = new THREE.Group();
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly hud: GalleryHud;
  private readonly maxAnisotropy: number;
  private readonly pointer = new THREE.Vector2(2, 2);
  private readonly pointerCurrent = new THREE.Vector2();
  private readonly pointerTarget = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly textureLoader = new THREE.TextureLoader();
  private animationFrame: number | null = null;
  private currentOffset = 0;
  private currentPlaneHeight = 1;
  private currentStride = 1;
  private currentTrackIndex = -1;
  private currentTotalWidth = 1;
  private destroyed = false;
  private films: FilmItem[] = [];
  private hoveredIndex: number | null = null;
  private hudActiveIndex = -1;
  private hudItemCount = -1;
  private interactive = true;
  private isPointerInside = false;
  private isVisible = true;
  private lastFrameTime = 0;
  private layout = calculateLayout(1, 1, 0);
  private onCurrentTrackChange: (track: Track) => void;
  private onSelect: (track: Track) => void;
  private onTextureError: (track: Track) => void;
  private previewDuration = 1;
  private previewFrom = 0;
  private previewProgress = 0;
  private previewStartedAt = 0;
  private previewTarget = 0;
  private previewTrackId: string | null = null;
  private quality: GalleryQuality;
  private raycastCount = 0;
  private raycastDirty = true;
  private renderCount = 0;
  private renderState: GalleryRenderState = "settling";
  private reducedMotion = false;
  private scrollVelocity = 0;
  private textureWindow = new Set<number>();
  private targetOffset = 0;
  private visualSettling = false;

  constructor({
    canvas,
    hudCanvas,
    onCurrentTrackChange,
    onSelect,
    onTextureError,
    tracks,
  }: FilmstripSceneOptions) {
    this.canvas = canvas;
    this.onCurrentTrackChange = onCurrentTrackChange;
    this.onSelect = onSelect;
    this.onTextureError = onTextureError;
    this.hud = new GalleryHud(hudCanvas);
    this.quality = resolveGalleryQuality();
    this.renderer = new THREE.WebGLRenderer({
      alpha: false,
      antialias: false,
      canvas,
      powerPreference: "high-performance",
    });
    this.maxAnisotropy = Math.min(
      this.renderer.capabilities.getMaxAnisotropy(),
      this.quality === "full" ? FULL_MAX_ANISOTROPY : CONSTRAINED_MAX_ANISOTROPY,
    );

    this.renderer.setClearColor(BACKGROUND_COLOR, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.background;
    this.scene.add(this.filmGroup);
    this.camera.position.z = 1000;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.isVisible = document.visibilityState !== "hidden";

    this.createFilms(tracks);
    this.resize();
    this.addEventListeners();
    this.updateDiagnostics();
    this.requestRender("settling");
  }

  setInteractive(interactive: boolean): void {
    this.interactive = interactive;

    if (!interactive) {
      this.hoveredIndex = null;
      this.pointerTarget.set(0, 0);
      this.canvas.style.cursor = "default";
    }

    this.raycastDirty = true;
    this.requestRender("settling");
  }

  setOnCurrentTrackChange(onCurrentTrackChange: (track: Track) => void): void {
    this.onCurrentTrackChange = onCurrentTrackChange;
  }

  setOnSelect(onSelect: (track: Track) => void): void {
    this.onSelect = onSelect;
  }

  setPreview(trackId: string | null, open: boolean): void {
    const target = open && trackId ? 1 : 0;
    const replacingTrack = Boolean(
      open
      && trackId
      && this.previewTrackId
      && this.previewTrackId !== trackId,
    );

    if (replacingTrack) {
      this.previewProgress = 0;
    }

    if (trackId) {
      this.previewTrackId = trackId;
    }

    if (target === this.previewTarget && !replacingTrack) {
      return;
    }

    this.previewFrom = this.previewProgress;
    this.previewTarget = target;
    const baseDuration = target === 1
      ? PREVIEW_ENTRY_DURATION
      : PREVIEW_EXIT_DURATION;
    this.previewDuration = this.reducedMotion
      ? 1
      : Math.max(1, baseDuration * Math.abs(target - this.previewFrom));
    this.previewStartedAt = this.lastFrameTime || performance.now();
    this.refreshTextureWindow();
    this.requestRender("previewing");
  }

  restoreTrack(trackId: string): void {
    const index = this.films.findIndex((film) => film.track.id === trackId);
    if (index === -1) {
      return;
    }

    const offset = THREE.MathUtils.clamp(
      -index * this.currentStride,
      this.getMinOffset(),
      0,
    );
    this.currentOffset = offset;
    this.targetOffset = offset;
    this.currentTrackIndex = -1;
    this.scrollVelocity = 0;
    this.raycastDirty = true;
    this.refreshTextureWindow();
    this.requestRender("settling");
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    if (this.animationFrame !== null) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.removeEventListeners();

    for (const film of this.films) {
      this.disposeFilmTextures(film);
      film.material.dispose();
      this.filmGroup.remove(film.mesh);
    }

    this.films = [];
    this.geometry.dispose();
    this.renderer.dispose();
  }

  private readonly animate = (time: number): void => {
    this.animationFrame = null;
    if (this.destroyed || !this.isVisible) {
      return;
    }

    const deltaSeconds = this.lastFrameTime === 0
      ? 1 / 60
      : Math.min((time - this.lastFrameTime) / 1000, 1 / 15);
    this.lastFrameTime = time;
    const previousOffset = this.currentOffset;
    const previousPointerX = this.pointerCurrent.x;
    const previousPointerY = this.pointerCurrent.y;
    const previousPreviewProgress = this.previewProgress;
    const minOffset = this.getMinOffset();

    this.targetOffset = THREE.MathUtils.clamp(this.targetOffset, minOffset, 0);
    this.currentOffset = THREE.MathUtils.lerp(
      this.currentOffset,
      this.targetOffset,
      frameDamping(WHEEL_DAMPING, deltaSeconds),
    );

    if (Math.abs(this.currentOffset - this.targetOffset) < OFFSET_EPSILON) {
      this.currentOffset = this.targetOffset;
    }

    this.currentOffset = THREE.MathUtils.clamp(this.currentOffset, minOffset, 0);
    this.updateScrollVelocity(previousOffset, deltaSeconds, minOffset);
    this.pointerCurrent.lerp(this.pointerTarget, frameDamping(0.1, deltaSeconds));
    this.updatePreviewProgress(time);
    const geometryChanged = Math.abs(this.currentOffset - previousOffset) > OFFSET_EPSILON
      || Math.abs(this.pointerCurrent.x - previousPointerX) > POINTER_SETTLE_EPSILON
      || Math.abs(this.pointerCurrent.y - previousPointerY) > POINTER_SETTLE_EPSILON
      || Math.abs(this.previewProgress - previousPreviewProgress) > POINTER_SETTLE_EPSILON;
    if (geometryChanged && this.isPointerInside) {
      this.raycastDirty = true;
    }
    this.updateFilms(deltaSeconds);
    this.updateHover();
    this.updateCurrentTrack();
    this.drawHud();
    this.renderer.render(this.scene, this.camera);
    this.renderCount += 1;
    this.canvas.dataset.renderCount = String(this.renderCount);

    if (this.hasPendingVisualMotion()) {
      this.requestRender(this.nextRenderState());
    } else {
      this.renderState = "idle";
      this.updateDiagnostics();
    }
  };

  private addEventListeners(): void {
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("wheel", this.handleWheel, { passive: false });
    this.canvas.addEventListener("click", this.handleClick);
    this.canvas.addEventListener("keydown", this.handleKeyDown);
    this.canvas.addEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private createFilms(tracks: readonly Track[]): void {
    this.films = tracks.map((track, index) => {
      const material = new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        fragmentShader: filmstripFragmentShader,
        uniforms: {
          uBrightness: { value: INACTIVE_BRIGHTNESS },
          uImageSize: { value: new THREE.Vector2(1, 1) },
          uPlaneSize: { value: new THREE.Vector2(1, 1) },
          uSaturation: { value: 0 },
          uTexture: { value: null },
        },
        vertexShader: filmstripVertexShader,
      });
      const mesh: FilmMesh = new THREE.Mesh(this.geometry, material);
      const fallbackTexture = createFallbackTexture(track);
      fallbackTexture.colorSpace = THREE.SRGBColorSpace;
      fallbackTexture.anisotropy = this.maxAnisotropy;
      material.uniforms.uTexture.value = fallbackTexture;
      mesh.renderOrder = index;
      this.filmGroup.add(mesh);

      const film: FilmItem = {
        brightness: INACTIVE_BRIGHTNESS,
        fallbackTexture,
        material,
        mesh,
        pendingTexture: null,
        remoteTexture: null,
        saturation: 0,
        texture: fallbackTexture,
        track,
        textureLoadGeneration: 0,
        textureFailed: false,
      };

      return film;
    });
  }

  private drawHud(): void {
    const activeIndex = this.getCurrentTrackIndex();
    const itemCount = this.previewProgress > 0.01 ? 0 : this.films.length;
    if (activeIndex === this.hudActiveIndex && itemCount === this.hudItemCount) {
      return;
    }

    this.hudActiveIndex = activeIndex;
    this.hudItemCount = itemCount;
    this.hud.draw(activeIndex, itemCount);
  }

  private readonly handleClick = (event: MouseEvent): void => {
    if (!this.interactive) {
      return;
    }

    this.updatePointer(event.clientX, event.clientY);
    this.updateHover(true);

    const track = this.hoveredIndex === null
      ? this.getNearestTrack(event.clientX, event.clientY)
      : this.films[this.hoveredIndex]?.track;

    if (track) {
      this.onSelect(track);
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.interactive || this.films.length === 0) {
      return;
    }

    const currentIndex = this.getCurrentTrackIndex();
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.moveToTrack(currentIndex - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      this.moveToTrack(currentIndex + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      this.moveToTrack(0);
    } else if (event.key === "End") {
      event.preventDefault();
      this.moveToTrack(this.films.length - 1);
    }
  };

  private readonly handlePointerLeave = (): void => {
    this.isPointerInside = false;
    this.hoveredIndex = null;
    this.pointer.set(2, 2);
    this.pointerTarget.set(0, 0);
    this.canvas.style.cursor = "default";
    this.raycastDirty = false;
    this.requestRender("settling");
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.isPointerInside = true;
    this.updatePointer(event.clientX, event.clientY);
    this.raycastDirty = true;
    this.requestRender("interacting");
  };

  private readonly handleResize = (): void => {
    this.resize();
    this.raycastDirty = true;
    this.requestRender("settling");
  };

  private readonly handleVisibilityChange = (): void => {
    this.isVisible = document.visibilityState !== "hidden";
    if (!this.isVisible) {
      if (this.animationFrame !== null) {
        window.cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
      this.lastFrameTime = 0;
      this.renderState = "hidden";
      this.updateDiagnostics();
      return;
    }

    this.raycastDirty = true;
    this.requestRender("settling");
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (!this.interactive || this.currentTotalWidth === 0) {
      return;
    }

    event.preventDefault();
    const wheelPixels = getWheelPixels(event, this.layout.height);
    const contribution = THREE.MathUtils.clamp(
      wheelPixels,
      -MAX_WHEEL_CONTRIBUTION,
      MAX_WHEEL_CONTRIBUTION,
    );
    this.targetOffset = THREE.MathUtils.clamp(
      this.targetOffset - contribution,
      this.getMinOffset(),
      0,
    );
    this.requestRender("interacting");
  };

  private getNearestTrack(clientX: number, clientY: number): Track | undefined {
    const worldX = (clientX / this.layout.width - 0.5) * this.layout.width;
    const worldY = (0.5 - clientY / this.layout.height) * this.layout.height;
    const nearestFilm = this.films.reduce<FilmItem | null>((nearest, film) => {
      if (!nearest) {
        return film;
      }

      return Math.abs(film.mesh.position.x - worldX)
        < Math.abs(nearest.mesh.position.x - worldX)
        ? film
        : nearest;
    }, null);

    if (
      nearestFilm
      && Math.abs(nearestFilm.mesh.position.x - worldX) <= this.currentStride * 0.5
      && Math.abs(nearestFilm.mesh.position.y - worldY) <= this.currentPlaneHeight * 0.5
    ) {
      return nearestFilm.track;
    }

    return undefined;
  }

  private getCurrentTrackIndex(): number {
    if (this.films.length === 0 || this.currentStride === 0) {
      return 0;
    }

    return THREE.MathUtils.clamp(
      Math.round(-this.currentOffset / this.currentStride),
      0,
      this.films.length - 1,
    );
  }

  private getMinOffset(stride = this.currentStride): number {
    return -Math.max(this.films.length - 1, 0) * Math.max(stride, 0);
  }

  private moveToTrack(index: number): void {
    const nextIndex = THREE.MathUtils.clamp(index, 0, this.films.length - 1);
    this.targetOffset = THREE.MathUtils.clamp(
      -nextIndex * this.currentStride,
      this.getMinOffset(),
      0,
    );
    this.requestRender("interacting");
  }

  private removeEventListeners(): void {
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("wheel", this.handleWheel);
    this.canvas.removeEventListener("click", this.handleClick);
    this.canvas.removeEventListener("keydown", this.handleKeyDown);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private replaceArtworkTexture(film: FilmItem, loadedTexture: THREE.Texture): void {
    if (this.destroyed) {
      loadedTexture.dispose();
      return;
    }

    const image = loadedTexture.image as { height?: number; width?: number };
    const imageWidth = image.width ?? 1;
    const imageHeight = image.height ?? 1;
    loadedTexture.colorSpace = THREE.SRGBColorSpace;
    loadedTexture.anisotropy = this.maxAnisotropy;
    const previousTexture = film.texture;
    film.texture = loadedTexture;
    film.remoteTexture = loadedTexture;
    film.material.uniforms.uTexture.value = loadedTexture;
    (film.material.uniforms.uImageSize.value as THREE.Vector2).set(imageWidth, imageHeight);
    if (previousTexture !== film.fallbackTexture) {
      previousTexture.dispose();
    }
    this.requestRender("settling");
  }

  private disposeFilmTextures(film: FilmItem): void {
    film.textureLoadGeneration += 1;
    film.pendingTexture?.dispose();
    film.pendingTexture = null;
    film.remoteTexture?.dispose();
    film.remoteTexture = null;
    film.fallbackTexture.dispose();
  }

  private ensureArtworkTexture(film: FilmItem): void {
    if (!film.track.artworkUrl || film.remoteTexture || film.pendingTexture || film.textureFailed) {
      return;
    }

    const generation = film.textureLoadGeneration + 1;
    film.textureLoadGeneration = generation;
    const pendingTexture = this.textureLoader.load(
      film.track.artworkUrl,
      (loadedTexture) => {
        if (this.destroyed
          || generation !== film.textureLoadGeneration
          || !this.textureWindow.has(this.films.indexOf(film))) {
          loadedTexture.dispose();
          return;
        }

        film.pendingTexture = null;
        this.replaceArtworkTexture(film, loadedTexture);
      },
      undefined,
      () => {
        if (generation !== film.textureLoadGeneration) {
          pendingTexture.dispose();
          return;
        }

        film.pendingTexture = null;
        film.textureFailed = true;
        pendingTexture.dispose();
        this.onTextureError(film.track);
      },
    );
    film.pendingTexture = pendingTexture;
  }

  private getTextureWindow(): Set<number> {
    const centerIndex = this.currentTrackIndex === -1
      ? this.getCurrentTrackIndex()
      : this.currentTrackIndex;
    const indexes = new Set<number>();
    const addRange = (index: number): void => {
      for (let candidate = index - TEXTURE_WINDOW_RADIUS;
        candidate <= index + TEXTURE_WINDOW_RADIUS;
        candidate += 1) {
        if (candidate >= 0 && candidate < this.films.length) {
          indexes.add(candidate);
        }
      }
    };

    addRange(centerIndex);
    if (this.previewTrackId) {
      const previewIndex = this.films.findIndex((film) => film.track.id === this.previewTrackId);
      if (previewIndex !== -1) {
        addRange(previewIndex);
      }
    }

    return indexes;
  }

  private refreshTextureWindow(): void {
    const nextWindow = this.getTextureWindow();
    this.textureWindow = nextWindow;

    this.films.forEach((film, index) => {
      if (nextWindow.has(index)) {
        this.ensureArtworkTexture(film);
        return;
      }

      film.textureLoadGeneration += 1;
      film.pendingTexture?.dispose();
      film.pendingTexture = null;
      if (!film.remoteTexture) {
        return;
      }

      const remoteTexture = film.remoteTexture;
      film.remoteTexture = null;
      film.texture = film.fallbackTexture;
      film.material.uniforms.uTexture.value = film.fallbackTexture;
      (film.material.uniforms.uImageSize.value as THREE.Vector2).set(1, 1);
      remoteTexture.dispose();
    });
  }

  private hasPendingVisualMotion(): boolean {
    return Math.abs(this.currentOffset - this.targetOffset) > OFFSET_EPSILON
      || Math.abs(this.scrollVelocity) >= 0.1
      || this.pointerCurrent.distanceTo(this.pointerTarget) > POINTER_SETTLE_EPSILON
      || Math.abs(this.previewProgress - this.previewTarget) > POINTER_SETTLE_EPSILON
      || this.visualSettling;
  }

  private nextRenderState(): Exclude<GalleryRenderState, "hidden" | "idle"> {
    if (Math.abs(this.previewProgress - this.previewTarget) > POINTER_SETTLE_EPSILON) {
      return "previewing";
    }

    if (Math.abs(this.currentOffset - this.targetOffset) > OFFSET_EPSILON
      || this.pointerCurrent.distanceTo(this.pointerTarget) > POINTER_SETTLE_EPSILON) {
      return "interacting";
    }

    return "settling";
  }

  private requestRender(state: Exclude<GalleryRenderState, "hidden" | "idle">): void {
    if (this.destroyed || !this.isVisible) {
      return;
    }

    this.renderState = state;
    if (this.animationFrame === null) {
      this.animationFrame = window.requestAnimationFrame(this.animate);
    }
    this.updateDiagnostics();
  }

  private updateDiagnostics(): void {
    if (this.canvas.dataset.galleryQuality !== this.quality) {
      this.canvas.dataset.galleryQuality = this.quality;
    }
    if (this.canvas.dataset.raycastCount !== String(this.raycastCount)) {
      this.canvas.dataset.raycastCount = String(this.raycastCount);
    }
    if (this.canvas.dataset.renderCount !== String(this.renderCount)) {
      this.canvas.dataset.renderCount = String(this.renderCount);
    }
    if (this.canvas.dataset.renderState !== this.renderState) {
      this.canvas.dataset.renderState = this.renderState;
    }
  }

  private resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      this.quality === "full" ? FULL_PIXEL_RATIO : CONSTRAINED_PIXEL_RATIO,
    );
    const previousStride = this.currentStride;

    this.layout = calculateLayout(width, height, this.films.length);
    this.currentStride = this.layout.stride;
    this.currentTotalWidth = this.layout.totalWidth;

    if (previousStride > 0 && this.currentStride > 0) {
      this.currentOffset = THREE.MathUtils.clamp(
        this.currentOffset / previousStride * this.currentStride,
        this.getMinOffset(),
        0,
      );
      this.targetOffset = THREE.MathUtils.clamp(
        this.targetOffset / previousStride * this.currentStride,
        this.getMinOffset(),
        0,
      );
    }

    this.camera.left = width * -0.5;
    this.camera.right = width * 0.5;
    this.camera.top = height * 0.5;
    this.camera.bottom = height * -0.5;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.hud.resize(width, height, pixelRatio);
    this.hudActiveIndex = -1;
    this.hudItemCount = -1;
  }

  private updateCurrentTrack(): void {
    const index = this.getCurrentTrackIndex();
    if (index === this.currentTrackIndex || !this.films[index]) {
      return;
    }

    this.currentTrackIndex = index;
    this.refreshTextureWindow();
    this.onCurrentTrackChange(this.films[index].track);
  }

  private updateFilms(deltaSeconds: number): void {
    if (this.films.length === 0 || this.layout.totalWidth === 0) {
      return;
    }

    const brightnessDamping = frameDamping(0.12, deltaSeconds);
    const waveStrength = this.reducedMotion || !this.interactive
      ? 0
      : THREE.MathUtils.clamp(Math.abs(this.scrollVelocity) / WAVE_FULL_SPEED, 0, 1);
    const waveDirection = Math.sign(this.scrollVelocity) || 1;
    this.currentPlaneHeight = this.layout.planeHeight
      * (1 + WAVE_SCALE_AMPLITUDE * waveStrength);

    const previewIndex = this.previewTrackId
      ? this.films.findIndex((film) => film.track.id === this.previewTrackId)
      : -1;
    const previewLayout = calculatePreviewLayout(this.layout.width, this.layout.height);

    this.visualSettling = false;
    this.films.forEach((film, index) => {
      const planeLeft = this.layout.originLeft + index * this.currentStride + this.currentOffset;
      const baseX = planeLeft + this.layout.planeWidth * 0.5 - this.layout.width * 0.5;
      const wavePhase = baseX / Math.max(this.layout.width, 1) * Math.PI * 2.4;
      const wave = Math.sin(wavePhase);
      const waveSlope = Math.cos(wavePhase);
      const verticalScale = 1 + wave * WAVE_SCALE_AMPLITUDE * waveStrength;
      const verticalOffset = wave * WAVE_VERTICAL_TRAVEL * waveStrength;
      const relativeIndex = index / Math.max(this.films.length - 1, 1) - 0.5;
      const isPreviewTrack = index === previewIndex;
      const neighbourDirection = Math.sign(index - previewIndex);
      const neighbourDisplacement = previewIndex === -1 || isPreviewTrack
        ? 0
        : neighbourDirection * (this.layout.width * 0.62 + previewLayout.size * 0.3)
          * this.previewProgress;
      const x = isPreviewTrack
        ? THREE.MathUtils.lerp(baseX, previewLayout.centerX, this.previewProgress)
        : baseX + neighbourDisplacement;
      const y = isPreviewTrack
        ? THREE.MathUtils.lerp(
          this.layout.worldCenterY + verticalOffset,
          previewLayout.centerY,
          this.previewProgress,
        )
        : this.layout.worldCenterY + verticalOffset;
      const planeWidth = isPreviewTrack
        ? THREE.MathUtils.lerp(
          this.layout.planeWidth,
          previewLayout.size,
          this.previewProgress,
        )
        : this.layout.planeWidth;
      const planeHeight = isPreviewTrack
        ? THREE.MathUtils.lerp(
          this.layout.planeHeight * verticalScale,
          previewLayout.size,
          this.previewProgress,
        )
        : this.layout.planeHeight * verticalScale;
      const targetBrightness = isPreviewTrack
        ? THREE.MathUtils.lerp(INACTIVE_BRIGHTNESS, 1, this.previewProgress)
        : index === this.hoveredIndex
        ? HOVER_BRIGHTNESS
        : THREE.MathUtils.lerp(INACTIVE_BRIGHTNESS, 0.12, this.previewProgress);
      const targetSaturation = isPreviewTrack ? this.previewProgress : 0;

      film.brightness = THREE.MathUtils.lerp(
        film.brightness,
        targetBrightness,
        brightnessDamping,
      );
      film.saturation = THREE.MathUtils.lerp(
        film.saturation,
        targetSaturation,
        brightnessDamping,
      );
      if (Math.abs(film.brightness - targetBrightness) > 0.005
        || Math.abs(film.saturation - targetSaturation) > 0.005) {
        this.visualSettling = true;
      }
      film.mesh.position.set(
        x,
        y,
        isPreviewTrack
          ? this.previewProgress * 24
          : relativeIndex * this.pointerCurrent.x * 18,
      );
      film.mesh.rotation.y = isPreviewTrack
        ? THREE.MathUtils.lerp(
          relativeIndex * this.pointerCurrent.x * 0.025,
          0,
          this.previewProgress,
        )
        : relativeIndex * this.pointerCurrent.x * 0.025;
      film.mesh.rotation.z = isPreviewTrack
        ? THREE.MathUtils.lerp(
          -waveDirection * waveSlope * WAVE_ROTATION * waveStrength,
          0,
          this.previewProgress,
        )
        : -waveDirection * waveSlope * WAVE_ROTATION * waveStrength;
      film.mesh.scale.set(planeWidth, planeHeight, 1);
      film.mesh.renderOrder = isPreviewTrack ? this.films.length + 1 : index;
      film.material.uniforms.uBrightness.value = film.brightness;
      film.material.uniforms.uSaturation.value = film.saturation;
      (film.material.uniforms.uPlaneSize.value as THREE.Vector2).set(
        planeWidth,
        planeHeight,
      );
    });

    const parallaxScale = this.reducedMotion ? 0 : 1;
    this.filmGroup.position.set(
      this.pointerCurrent.x * 7 * parallaxScale,
      this.pointerCurrent.y * 5 * parallaxScale,
      0,
    );

    if (this.previewTrackId) {
      this.canvas.dataset.previewMeshTrackId = this.previewTrackId;
      this.canvas.dataset.previewProgress = this.previewProgress.toFixed(3);
    } else {
      delete this.canvas.dataset.previewMeshTrackId;
      delete this.canvas.dataset.previewProgress;
    }
  }

  private updatePreviewProgress(time: number): void {
    if (this.previewProgress === this.previewTarget) {
      return;
    }

    const elapsed = Math.max(0, time - this.previewStartedAt);
    const linearProgress = THREE.MathUtils.clamp(elapsed / this.previewDuration, 0, 1);
    const easedProgress = this.previewTarget === 1
      ? easeOutQuint(linearProgress)
      : easeInOutCubic(linearProgress);
    this.previewProgress = THREE.MathUtils.lerp(
      this.previewFrom,
      this.previewTarget,
      easedProgress,
    );

    if (linearProgress === 1) {
      this.previewProgress = this.previewTarget;
      if (this.previewTarget === 0) {
        this.previewTrackId = null;
      }
    }
  }

  private updateHover(force = false): void {
    if (!force && !this.raycastDirty) {
      return;
    }

    this.raycastDirty = false;
    if (!this.interactive || !this.isPointerInside) {
      if (this.hoveredIndex !== null) {
        this.hoveredIndex = null;
        this.visualSettling = true;
      }
      this.canvas.style.cursor = "default";
      return;
    }

    this.scene.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(
      this.films.map((film) => film.mesh),
      false,
    );
    this.raycastCount += 1;
    this.canvas.dataset.raycastCount = String(this.raycastCount);
    const intersectedMesh = intersections[0]?.object;
    const index = intersectedMesh
      ? this.films.findIndex((film) => film.mesh === intersectedMesh)
      : -1;
    const nextHoveredIndex = index === -1 ? null : index;
    if (nextHoveredIndex !== this.hoveredIndex) {
      this.hoveredIndex = nextHoveredIndex;
      this.visualSettling = true;
    }
    this.canvas.style.cursor = this.hoveredIndex === null ? "default" : "pointer";
  }

  private updatePointer(clientX: number, clientY: number): void {
    this.pointer.set(
      clientX / this.layout.width * 2 - 1,
      -(clientY / this.layout.height) * 2 + 1,
    );
    this.pointerTarget.copy(this.pointer);

    if (this.reducedMotion) {
      this.pointerTarget.set(0, 0);
    }
  }

  private updateScrollVelocity(
    previousOffset: number,
    deltaSeconds: number,
    minOffset: number,
  ): void {
    const actualVelocity = (this.currentOffset - previousOffset) / deltaSeconds;
    const boundaryLocked = (
      Math.abs(this.currentOffset) < OFFSET_EPSILON
      && Math.abs(this.targetOffset) < OFFSET_EPSILON
    ) || (
      Math.abs(this.currentOffset - minOffset) < OFFSET_EPSILON
      && Math.abs(this.targetOffset - minOffset) < OFFSET_EPSILON
    );

    if (boundaryLocked) {
      this.scrollVelocity = 0;
      return;
    }

    this.scrollVelocity = THREE.MathUtils.lerp(
      this.scrollVelocity,
      actualVelocity,
      frameDamping(Math.abs(actualVelocity) > 1 ? 0.18 : 0.08, deltaSeconds),
    );

    if (Math.abs(this.scrollVelocity) < 0.1) {
      this.scrollVelocity = 0;
    }
  }
}
