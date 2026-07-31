"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type KeyboardEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { AlbumArtwork } from "@/components/AlbumArtwork";
import { IconButton } from "@/components/IconButton";
import { Skeleton } from "@/components/Skeleton";
import type { Track } from "@/lib/music/models";
import { FilmstripScene } from "@/lib/webgl/filmstripScene";

import styles from "./FilmstripGallery.module.css";

export type FilmstripRenderer = "canvas" | "fallback";
type FilmstripPreviewPhase = "hidden" | "entering" | "visible" | "exiting";

export interface FilmstripGalleryHandle {
  focus(): void;
}

interface FilmstripGalleryProps {
  isInteractive: boolean;
  isLoading: boolean;
  onCurrentTrackChange: (track: Track) => void;
  onRendererChange?: (renderer: FilmstripRenderer) => void;
  onSelect: (track: Track) => void;
  previewPhase: FilmstripPreviewPhase;
  previewTrackId: string | null;
  restoreTrackId?: string | null;
  selectedTrackId: string | null;
  tracks: readonly Track[];
}

export const FilmstripGallery = forwardRef<
  FilmstripGalleryHandle,
  FilmstripGalleryProps
>(function FilmstripGallery({
  isInteractive,
  isLoading,
  onCurrentTrackChange,
  onRendererChange,
  onSelect,
  previewPhase,
  previewTrackId,
  restoreTrackId,
  selectedTrackId,
  tracks,
}, forwardedRef) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<FilmstripScene | null>(null);
  const [renderer, setRenderer] = useState<FilmstripRenderer>("canvas");
  const [failedArtworkTrackIds, setFailedArtworkTrackIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const hasTracks = tracks.length > 0;
  const showLoading = isLoading && !hasTracks;
  const hasTextureFallback = tracks.some((track) => (
    track.artworkUrl === null || failedArtworkTrackIds.has(track.id)
  ));

  useImperativeHandle(forwardedRef, () => ({
    focus(): void {
      if (renderer === "canvas") {
        canvasRef.current?.focus({ preventScroll: true });
      } else {
        fallbackRef.current?.focus({ preventScroll: true });
      }
    },
  }), [renderer]);

  useEffect(() => {
    if (!hasTracks || showLoading || renderer === "fallback") {
      return;
    }

    const canvas = canvasRef.current;
    const hudCanvas = hudCanvasRef.current;

    if (!canvas || !hudCanvas) {
      return;
    }

    let scene: FilmstripScene;

    try {
      scene = new FilmstripScene({
        canvas,
        hudCanvas,
        onCurrentTrackChange,
        onSelect,
        onTextureError: (track) => {
          setFailedArtworkTrackIds((previous) => {
            if (previous.has(track.id)) {
              return previous;
            }

            return new Set(previous).add(track.id);
          });
        },
        tracks,
      });
    } catch {
      const fallbackTimer = window.setTimeout(() => setRenderer("fallback"), 0);
      return () => window.clearTimeout(fallbackTimer);
    }

    sceneRef.current = scene;

    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, [hasTracks, onCurrentTrackChange, onSelect, renderer, showLoading, tracks]);

  useEffect(() => {
    sceneRef.current?.setInteractive(isInteractive);
  }, [isInteractive, tracks]);

  useEffect(() => {
    sceneRef.current?.setOnCurrentTrackChange(onCurrentTrackChange);
  }, [onCurrentTrackChange]);

  useEffect(() => {
    sceneRef.current?.setOnSelect(onSelect);
  }, [onSelect]);

  useEffect(() => {
    sceneRef.current?.setPreview(
      previewTrackId,
      previewPhase === "entering" || previewPhase === "visible",
    );
  }, [previewPhase, previewTrackId, tracks]);

  useEffect(() => {
    onRendererChange?.(renderer);
  }, [onRendererChange, renderer]);

  useEffect(() => {
    if (restoreTrackId) {
      sceneRef.current?.restoreTrack(restoreTrackId);
    }
  }, [restoreTrackId, tracks]);

  return (
    <section
      aria-label="Daily track gallery"
      className={styles.gallery}
      data-artwork-fallback={hasTextureFallback || undefined}
      data-interactive={isInteractive}
      data-preview={previewPhase !== "hidden" || undefined}
      data-renderer={showLoading ? "loading" : renderer}
    >
      {showLoading ? <GallerySkeleton /> : null}
      {!showLoading && !hasTracks ? <EmptyGallery /> : null}
      {!showLoading && hasTracks && renderer === "canvas" ? (
        <>
          <canvas
            ref={canvasRef}
            aria-label="Interactive daily track gallery"
            className={styles.webglCanvas}
            tabIndex={isInteractive ? 0 : -1}
          />
          <canvas ref={hudCanvasRef} className={styles.hudCanvas} aria-hidden="true" />
        </>
      ) : null}
      {!showLoading && hasTracks && renderer === "fallback" ? (
        <FallbackGallery
          isInteractive={isInteractive}
          onCurrentTrackChange={onCurrentTrackChange}
          onSelect={onSelect}
          ref={fallbackRef}
          selectedTrackId={selectedTrackId}
          tracks={tracks}
        />
      ) : null}
    </section>
  );
});

function GallerySkeleton() {
  return (
    <div aria-label="正在加载歌曲画廊" className={styles.skeleton} role="status">
      <Skeleton className={styles.skeletonSlice} variant="block" />
      <Skeleton className={styles.skeletonSlice} variant="block" />
      <Skeleton className={styles.skeletonSlice} variant="block" />
    </div>
  );
}

function EmptyGallery() {
  return (
    <div aria-live="polite" className={styles.empty} role="status">
      <p>当前没有可展示的歌曲。</p>
    </div>
  );
}

interface FallbackGalleryProps {
  isInteractive: boolean;
  onCurrentTrackChange: (track: Track) => void;
  onSelect: (track: Track) => void;
  selectedTrackId: string | null;
  tracks: readonly Track[];
}

const FallbackGallery = forwardRef<HTMLDivElement, FallbackGalleryProps>(function FallbackGallery({
  isInteractive,
  onCurrentTrackChange,
  onSelect,
  selectedTrackId,
  tracks,
}, forwardedRef) {
  const selectedIndex = useMemo(() => {
    const index = tracks.findIndex((track) => track.id === selectedTrackId);
    return index === -1 ? 0 : index;
  }, [selectedTrackId, tracks]);
  const selectedTrack = tracks[selectedIndex];

  function selectRelative(delta: number): void {
    const nextIndex = Math.min(
      Math.max(selectedIndex + delta, 0),
      tracks.length - 1,
    );
    onCurrentTrackChange(tracks[nextIndex]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (!isInteractive) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectRelative(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      selectRelative(1);
    } else if (event.key === "Home") {
      event.preventDefault();
      onCurrentTrackChange(tracks[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      onCurrentTrackChange(tracks[tracks.length - 1]);
    }
  }

  return (
    <div
      aria-label="可操作的歌曲画廊降级列表"
      className={styles.fallback}
      onKeyDown={handleKeyDown}
      ref={forwardedRef}
      tabIndex={isInteractive ? 0 : -1}
    >
      <div className={styles.fallbackHeader}>
        <p className={styles.fallbackLabel}>歌曲画廊已切换为兼容模式</p>
        <div className={styles.fallbackControls}>
          <IconButton
            disabled={!isInteractive || selectedIndex === 0}
            icon={<ChevronLeft aria-hidden="true" />}
            label="上一首推荐歌曲"
            onClick={() => selectRelative(-1)}
            tooltip="上一首推荐歌曲"
          />
          <IconButton
            disabled={!isInteractive || selectedIndex === tracks.length - 1}
            icon={<ChevronRight aria-hidden="true" />}
            label="下一首推荐歌曲"
            onClick={() => selectRelative(1)}
            tooltip="下一首推荐歌曲"
          />
        </div>
      </div>
      <ol className={styles.trackList}>
        {tracks.map((track) => {
          const isSelected = track.id === selectedTrack?.id;
          return (
            <li className={styles.trackItem} key={track.id}>
              <AlbumArtwork
                alt={`选择歌曲 ${track.name}`}
                disabled={!isInteractive}
                onClick={() => onSelect(track)}
                selected={isSelected}
                src={track.artworkUrl}
                status={track.artworkUrl ? "idle" : "empty"}
                variant="film-slice"
              />
              <span aria-current={isSelected ? "true" : undefined} className={styles.trackName}>
                {track.name}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
});
