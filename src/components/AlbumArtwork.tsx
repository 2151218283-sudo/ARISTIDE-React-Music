import { Ban, Disc3 } from "lucide-react";
import Image from "next/image";
import type { ReactEventHandler } from "react";

import styles from "./AlbumArtwork.module.css";

export type AlbumArtworkVariant =
  | "film-slice"
  | "thumbnail"
  | "tile"
  | "preview"
  | "player";

export type AlbumArtworkStatus =
  | "idle"
  | "loading"
  | "loaded"
  | "empty"
  | "error"
  | "unavailable";

export interface AlbumArtworkProps {
  alt: string;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  onError?: ReactEventHandler<HTMLImageElement>;
  onLoad?: ReactEventHandler<HTMLImageElement>;
  playing?: boolean;
  priority?: boolean;
  selected?: boolean;
  sizes?: string;
  src: string | null;
  status?: AlbumArtworkStatus;
  variant?: AlbumArtworkVariant;
}

const variantClasses: Record<AlbumArtworkVariant, string> = {
  "film-slice": styles.filmSlice,
  thumbnail: styles.thumbnail,
  tile: styles.tile,
  preview: styles.preview,
  player: styles.player,
};

const variantSizes: Record<AlbumArtworkVariant, string> = {
  "film-slice": "(max-width: 767px) 35px, (max-width: 1023px) 56px, 8vw",
  thumbnail: "48px",
  tile: "(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 20vw",
  preview: "(max-width: 767px) calc(100vw - 32px), (max-width: 1023px) 62vw, 42vw",
  player: "(max-width: 767px) 72vw, (max-width: 1023px) 54vw, 38vw",
};

export function AlbumArtwork({
  alt,
  className,
  disabled = false,
  onClick,
  onError,
  onLoad,
  playing = false,
  priority = false,
  selected = false,
  sizes,
  src,
  status = src ? "idle" : "empty",
  variant = "tile",
}: AlbumArtworkProps) {
  const interactive = typeof onClick === "function";
  const classes = [
    styles.artwork,
    variantClasses[variant],
    interactive ? styles.interactive : null,
    className,
  ].filter(Boolean).join(" ");
  const showImage = Boolean(src)
    && status !== "empty"
    && status !== "error"
    && status !== "loading";
  const stateLabel = status === "loading"
    ? "正在加载"
    : status === "empty"
      ? "暂无封面"
      : status === "error"
        ? "封面无法加载"
        : status === "unavailable"
          ? "不可播放"
          : null;
  const accessibleLabel = [alt, stateLabel, playing ? "正在播放" : null]
    .filter(Boolean)
    .join("，");
  const content = (
    <>
      {showImage ? (
        <Image
          alt={interactive ? "" : alt}
          className={styles.image}
          decoding="async"
          fill
          loading={priority ? "eager" : "lazy"}
          onError={onError}
          onLoad={onLoad}
          sizes={sizes ?? variantSizes[variant]}
          src={src ?? ""}
          unoptimized
        />
      ) : null}
      {status === "loading" ? (
        <span className={styles.loadingSurface} aria-hidden="true" />
      ) : null}
      {status === "empty" || status === "error" ? (
        <span className={styles.fallback} aria-hidden="true">
          <Disc3 className={styles.fallbackIcon} strokeWidth={1.6} />
          <span>{status === "error" ? "封面无法加载" : "暂无封面"}</span>
        </span>
      ) : null}
      {status === "unavailable" ? (
        <span className={styles.unavailable} aria-hidden="true">
          <Ban className={styles.unavailableIcon} strokeWidth={1.8} />
          <span className={styles.unavailableText}>不可播放</span>
        </span>
      ) : null}
      {playing ? (
        <span className={styles.playingMarker}>
          <span className={styles.srOnly}>正在播放</span>
          <span className={styles.playingBar} aria-hidden="true" />
          <span className={styles.playingBar} aria-hidden="true" />
          <span className={styles.playingBar} aria-hidden="true" />
        </span>
      ) : null}
    </>
  );

  if (interactive) {
    return (
      <button
        aria-busy={status === "loading" || undefined}
        aria-label={accessibleLabel}
        className={classes}
        data-playing={playing || undefined}
        data-selected={selected || undefined}
        data-status={status}
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <span
      aria-busy={status === "loading" || undefined}
      aria-label={showImage ? undefined : accessibleLabel}
      className={classes}
      data-playing={playing || undefined}
      data-selected={selected || undefined}
      data-status={status}
      role={showImage ? undefined : "img"}
    >
      {content}
    </span>
  );
}
