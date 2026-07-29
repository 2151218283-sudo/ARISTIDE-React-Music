import * as THREE from "three";

import { getProjectAccent } from "@/data/projectColors";
import type { Project } from "@/types/project";
import { GalleryHud } from "./galleryHud";
import {
  filmstripFragmentShader,
  filmstripVertexShader,
} from "./filmstripShaders";

const BACKGROUND_COLOR = 0x141414;
const DETAILS_BACKGROUND_COLOR = 0x4c5156;
const INACTIVE_BRIGHTNESS = 0.55;
const HOVER_BRIGHTNESS = 0.9;
const WHEEL_DAMPING = 0.08;
const MAX_WHEEL_CONTRIBUTION = 140;
const OFFSET_EPSILON = 0.05;
const WAVE_FULL_SPEED = 900;
const WAVE_SCALE_AMPLITUDE = 0.27;
const WAVE_VERTICAL_TRAVEL = 22;
const WAVE_ROTATION = THREE.MathUtils.degToRad(4);

type FilmMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

interface FilmItem {
  brightness: number;
  material: THREE.ShaderMaterial;
  mesh: FilmMesh;
  project: Project;
  saturation: number;
  texture: THREE.Texture;
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

interface FilmstripSceneOptions {
  canvas: HTMLCanvasElement;
  hudCanvas: HTMLCanvasElement;
  projects: Project[];
  onSelect: (project: Project) => void;
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
    originLeft: width * 0.71,
    planeHeight,
    planeWidth,
    stride,
    totalWidth: stride * itemCount,
    width,
    worldCenterY: height * -0.25,
  };
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

export class FilmstripScene {
  private readonly backgroundCurrent = new THREE.Color(BACKGROUND_COLOR);
  private readonly backgroundDetails = new THREE.Color(DETAILS_BACKGROUND_COLOR);
  private readonly backgroundHome = new THREE.Color(BACKGROUND_COLOR);
  private readonly camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 2000);
  private readonly canvas: HTMLCanvasElement;
  private readonly filmGroup = new THREE.Group();
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly hud: GalleryHud;
  private readonly pointer = new THREE.Vector2(2, 2);
  private readonly pointerCurrent = new THREE.Vector2();
  private readonly pointerTarget = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly textureLoader = new THREE.TextureLoader();
  private activeIndex: number | null = null;
  private animationFrame = 0;
  private currentOffset = 0;
  private currentPlaneHeight = 1;
  private currentStride = 1;
  private currentTotalWidth = 1;
  private detailsProgress = 0;
  private destroyed = false;
  private films: FilmItem[] = [];
  private hoveredIndex: number | null = null;
  private interactive = true;
  private isPointerInside = false;
  private lastFrameTime = 0;
  private layout = calculateLayout(1, 1, 0);
  private onSelect: (project: Project) => void;
  private overview = false;
  private overviewProgress = 0;
  private reducedMotion = false;
  private scrollVelocity = 0;
  private targetOffset = 0;
  private transitionIndex: number | null = null;

  constructor({ canvas, hudCanvas, projects, onSelect }: FilmstripSceneOptions) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.hud = new GalleryHud(hudCanvas);
    this.renderer = new THREE.WebGLRenderer({
      alpha: false,
      antialias: true,
      canvas,
      powerPreference: "high-performance",
    });

    this.renderer.setClearColor(BACKGROUND_COLOR, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.backgroundCurrent;
    this.scene.add(this.filmGroup);
    this.camera.position.z = 1000;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.createFilms(projects);
    this.resize();
    this.addEventListeners();
    this.animationFrame = window.requestAnimationFrame(this.animate);
  }

  setActiveProject(project: Project | null): void {
    const nextIndex = project
      ? this.films.findIndex((film) => film.project.slug === project.slug)
      : null;

    this.activeIndex = nextIndex === -1 ? null : nextIndex;

    if (this.activeIndex !== null) {
      this.transitionIndex = this.activeIndex;
    }
  }

  setOverview(overview: boolean): void {
    this.overview = overview;
  }

  setInteractive(interactive: boolean): void {
    this.interactive = interactive;

    if (!interactive) {
      this.hoveredIndex = null;
      this.pointerTarget.set(0, 0);
      this.canvas.style.cursor = "default";
    }
  }

  setOnSelect(onSelect: (project: Project) => void): void {
    this.onSelect = onSelect;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    window.cancelAnimationFrame(this.animationFrame);
    this.removeEventListeners();

    for (const film of this.films) {
      film.texture.dispose();
      film.material.dispose();
      this.filmGroup.remove(film.mesh);
    }

    this.films = [];
    this.geometry.dispose();
    this.renderer.dispose();
  }

  private readonly animate = (time: number): void => {
    if (this.destroyed) {
      return;
    }

    const deltaSeconds = this.lastFrameTime === 0
      ? 1 / 60
      : Math.min((time - this.lastFrameTime) / 1000, 1 / 15);
    this.lastFrameTime = time;
    const wheelDamping = frameDamping(WHEEL_DAMPING, deltaSeconds);
    const pointerDamping = frameDamping(0.1, deltaSeconds);
    const previousOffset = this.currentOffset;
    const minOffset = this.getMinOffset();

    this.targetOffset = THREE.MathUtils.clamp(
      this.targetOffset,
      minOffset,
      0,
    );

    this.currentOffset = THREE.MathUtils.lerp(
      this.currentOffset,
      this.targetOffset,
      wheelDamping,
    );

    if (Math.abs(this.currentOffset - this.targetOffset) < OFFSET_EPSILON) {
      this.currentOffset = this.targetOffset;
    }

    this.currentOffset = THREE.MathUtils.clamp(
      this.currentOffset,
      minOffset,
      0,
    );
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
    } else {
      const velocityDamping = frameDamping(
        Math.abs(actualVelocity) > 1 ? 0.18 : 0.08,
        deltaSeconds,
      );
      this.scrollVelocity = THREE.MathUtils.lerp(
        this.scrollVelocity,
        actualVelocity,
        velocityDamping,
      );

      if (Math.abs(this.scrollVelocity) < 0.1) {
        this.scrollVelocity = 0;
      }
    }

    this.pointerCurrent.lerp(this.pointerTarget, pointerDamping);
    this.updateFilms(deltaSeconds);
    this.updateHover();
    this.drawHud();
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = window.requestAnimationFrame(this.animate);
  };

  private addEventListeners(): void {
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("wheel", this.handleWheel, { passive: false });
    this.canvas.addEventListener("click", this.handleClick);
    this.canvas.addEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
  }

  private createFilms(projects: Project[]): void {
    this.films = projects.map((project, index) => {
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
      const texture = this.textureLoader.load(project.image, (loadedTexture) => {
        if (this.destroyed) {
          return;
        }

        const image = loadedTexture.image as { height?: number; width?: number };
        const imageWidth = image.width ?? 1;
        const imageHeight = image.height ?? 1;
        const imageSize = material.uniforms.uImageSize.value as THREE.Vector2;
        imageSize.set(imageWidth, imageHeight);
      });

      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
      material.uniforms.uTexture.value = texture;
      mesh.renderOrder = index;
      this.filmGroup.add(mesh);

      return {
        brightness: INACTIVE_BRIGHTNESS,
        material,
        mesh,
        project,
        saturation: 0,
        texture,
      };
    });
  }

  private drawHud(): void {
    if (this.films.length === 0 || this.currentStride === 0) {
      this.hud.draw(0, undefined, this.overviewProgress);
      return;
    }

    const projectProgress = THREE.MathUtils.clamp(
      Math.round(-this.currentOffset / this.currentStride),
      0,
      this.films.length - 1,
    );
    const color = this.activeIndex === null
      ? "rgb(186, 196, 184)"
      : getProjectAccent(this.activeIndex);
    this.hud.draw(projectProgress, color, this.overviewProgress);
  }

  private readonly handleClick = (event: MouseEvent): void => {
    if (!this.interactive) {
      return;
    }

    this.updatePointer(event.clientX, event.clientY);
    this.updateHover();

    if (!this.overview) {
      const entryProject = this.hoveredIndex === null
        ? this.films[0]?.project
        : this.films[this.hoveredIndex].project;

      if (entryProject) {
        this.onSelect(entryProject);
      }

      return;
    }

    if (this.hoveredIndex !== null) {
      this.onSelect(this.films[this.hoveredIndex].project);
      return;
    }

    const worldX = (event.clientX / this.layout.width - 0.5) * this.layout.width;
    const worldY = (0.5 - event.clientY / this.layout.height) * this.layout.height;
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
      this.onSelect(nearestFilm.project);
    }
  };

  private readonly handlePointerLeave = (): void => {
    this.isPointerInside = false;
    this.hoveredIndex = null;
    this.pointer.set(2, 2);
    this.pointerTarget.set(0, 0);
    this.canvas.style.cursor = "default";
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.isPointerInside = true;
    this.updatePointer(event.clientX, event.clientY);
  };

  private readonly handleResize = (): void => {
    this.resize();
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();

    if (!this.interactive || this.currentTotalWidth === 0) {
      return;
    }

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
  };

  private removeEventListeners(): void {
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("wheel", this.handleWheel);
    this.canvas.removeEventListener("click", this.handleClick);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
  }

  private resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    this.layout = calculateLayout(width, height, this.films.length);

    this.camera.left = width * -0.5;
    this.camera.right = width * 0.5;
    this.camera.top = height * 0.5;
    this.camera.bottom = height * -0.5;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.hud.resize(width, height, pixelRatio);
  }

  private updateFilms(deltaSeconds: number): void {
    if (this.films.length === 0 || this.layout.totalWidth === 0) {
      return;
    }

    const modeDamping = frameDamping(0.08, deltaSeconds);
    const brightnessDamping = frameDamping(0.12, deltaSeconds);
    const hasActiveProject = this.activeIndex !== null;
    const widthRatio = this.layout.width / 1920;
    const overviewWidth = this.layout.width < 700
      ? 35
      : 100 * widthRatio;
    const overviewHeight = this.layout.width < 700
      ? this.layout.height * 0.162
      : 370 * widthRatio;
    const overviewGap = this.layout.width < 700 ? 7 : 20 * widthRatio;

    this.overviewProgress = THREE.MathUtils.lerp(
      this.overviewProgress,
      this.overview ? 1 : 0,
      modeDamping,
    );
    this.detailsProgress = THREE.MathUtils.lerp(
      this.detailsProgress,
      hasActiveProject ? 1 : 0,
      modeDamping,
    );

    if (!hasActiveProject && this.detailsProgress < 0.001) {
      this.detailsProgress = 0;
      this.transitionIndex = null;
    }

    const browseWidth = THREE.MathUtils.lerp(
      this.layout.planeWidth,
      overviewWidth,
      this.overviewProgress,
    );
    const browseHeight = THREE.MathUtils.lerp(
      this.layout.planeHeight,
      overviewHeight,
      this.overviewProgress,
    );
    const browseGap = THREE.MathUtils.lerp(
      this.layout.gap,
      overviewGap,
      this.overviewProgress,
    );
    const detailsWidth = this.layout.width < 700
      ? this.layout.width * 0.86
      : 1054 * widthRatio;
    const detailsHeight = this.layout.width < 700
      ? this.layout.height * 0.5
      : 602 * widthRatio;
    const detailsGap = this.layout.width < 700
      ? this.layout.width * 0.12
      : 152 * widthRatio;
    const browseStride = browseWidth + browseGap;
    const detailsNeighborWidth = Math.max(
      detailsWidth * 0.5,
      (this.layout.width - detailsWidth - detailsGap * 2) * 0.5,
    );
    const overviewOriginLeft = (this.layout.width - overviewWidth) * 0.5;
    const originLeft = THREE.MathUtils.lerp(
      this.layout.originLeft,
      overviewOriginLeft,
      this.overviewProgress,
    );
    const worldCenterY = THREE.MathUtils.lerp(
      this.layout.worldCenterY,
      0,
      this.overviewProgress,
    );

    const previousStride = this.currentStride;

    if (
      previousStride > 0
      && Math.abs(previousStride - browseStride) > Number.EPSILON
    ) {
      const minOffset = this.getMinOffset(browseStride);
      this.currentOffset = THREE.MathUtils.clamp(
        this.currentOffset / previousStride * browseStride,
        minOffset,
        0,
      );
      this.targetOffset = THREE.MathUtils.clamp(
        this.targetOffset / previousStride * browseStride,
        minOffset,
        0,
      );
    }

    this.currentStride = browseStride;
    this.currentTotalWidth = browseStride * this.films.length;
    const waveStrength = this.reducedMotion || !this.interactive
      ? 0
      : THREE.MathUtils.clamp(
        Math.abs(this.scrollVelocity) / WAVE_FULL_SPEED,
        0,
        1,
      ) * this.overviewProgress * (1 - this.detailsProgress);
    const waveDirection = Math.sign(this.scrollVelocity) || 1;

    this.currentPlaneHeight = THREE.MathUtils.lerp(
      browseHeight,
      detailsHeight,
      this.detailsProgress,
    )
      * (1 + WAVE_SCALE_AMPLITUDE * waveStrength);

    this.backgroundCurrent.lerp(
      hasActiveProject ? this.backgroundDetails : this.backgroundHome,
      modeDamping,
    );

    this.films.forEach((film, index) => {
      const planeLeft = originLeft + index * browseStride + this.currentOffset;

      const filmX = planeLeft + browseWidth * 0.5 - this.layout.width * 0.5;
      let detailsX = filmX;
      let detailsTargetWidth = browseWidth;

      if (this.transitionIndex !== null) {
        const relativeIndex = index - this.transitionIndex;
        const distance = Math.abs(relativeIndex);
        const direction = Math.sign(relativeIndex);

        if (distance === 0) {
          detailsTargetWidth = detailsWidth;
          detailsX = 0;
        } else if (distance === 1) {
          detailsTargetWidth = detailsNeighborWidth;
          detailsX = direction * (
            detailsWidth * 0.5
            + detailsGap
            + detailsNeighborWidth * 0.5
          );
        } else {
          const farDistance = (
            detailsWidth * 0.5
            + detailsGap
            + detailsNeighborWidth
            + detailsGap
            + (browseWidth + detailsGap) * (distance - 2)
            + detailsGap * (distance - 1) ** 2 * 0.1
            + browseWidth * 0.5
          );
          detailsX = direction * farDistance;
        }
      }

      const displayWidth = THREE.MathUtils.lerp(
        browseWidth,
        detailsTargetWidth,
        this.detailsProgress,
      );
      const displayHeight = THREE.MathUtils.lerp(
        browseHeight,
        detailsHeight,
        this.detailsProgress,
      );
      const x = THREE.MathUtils.lerp(filmX, detailsX, this.detailsProgress);
      const y = THREE.MathUtils.lerp(worldCenterY, 0, this.detailsProgress);
      const wavePhase = x / Math.max(this.layout.width, 1) * Math.PI * 2.4;
      const wave = Math.sin(wavePhase);
      const waveSlope = Math.cos(wavePhase);
      const verticalScale = 1 + wave * WAVE_SCALE_AMPLITUDE * waveStrength;
      const verticalOffset = wave * WAVE_VERTICAL_TRAVEL * waveStrength;
      const relativeIndex = index / Math.max(this.films.length - 1, 1) - 0.5;
      const isActive = index === this.activeIndex;
      const isTransitionProject = index === this.transitionIndex;
      const targetBrightness = hasActiveProject
        ? isActive ? 1 : 0.3
        : index === this.hoveredIndex ? HOVER_BRIGHTNESS : INACTIVE_BRIGHTNESS;
      const targetSaturation = isTransitionProject ? this.detailsProgress : 0;

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
      film.mesh.position.set(
        x,
        y + verticalOffset,
        isActive ? 32 : relativeIndex * this.pointerCurrent.x * 18,
      );
      film.mesh.rotation.y = relativeIndex
        * this.pointerCurrent.x
        * 0.025
        * (1 - this.detailsProgress);
      film.mesh.rotation.z = -waveDirection
        * waveSlope
        * WAVE_ROTATION
        * waveStrength;
      film.mesh.scale.set(displayWidth, displayHeight * verticalScale, 1);
      film.mesh.renderOrder = isActive ? this.films.length + 1 : index;
      film.material.uniforms.uBrightness.value = film.brightness;
      film.material.uniforms.uSaturation.value = film.saturation;
      (film.material.uniforms.uPlaneSize.value as THREE.Vector2).set(
        displayWidth,
        displayHeight * verticalScale,
      );
    });

    const parallaxScale = this.reducedMotion ? 0 : 1;
    this.filmGroup.position.set(
      this.pointerCurrent.x * 7 * parallaxScale,
      this.pointerCurrent.y * 5 * parallaxScale,
      0,
    );
  }

  private updateHover(): void {
    if (!this.interactive || !this.isPointerInside) {
      this.hoveredIndex = null;
      this.canvas.style.cursor = "default";
      return;
    }

    this.scene.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(
      this.films.map((film) => film.mesh),
      false,
    );
    const intersectedMesh = intersections[0]?.object;
    this.hoveredIndex = intersectedMesh
      ? this.films.findIndex((film) => film.mesh === intersectedMesh)
      : null;

    if (this.hoveredIndex === -1) {
      this.hoveredIndex = null;
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

  private getMinOffset(stride = this.currentStride): number {
    return -Math.max(this.films.length - 1, 0) * Math.max(stride, 0);
  }
}
