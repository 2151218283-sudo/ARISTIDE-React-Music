"use client";

import { Bookmark, Heart } from "lucide-react";
import { useState } from "react";

import { IconButton } from "@/components/IconButton";
import type { AlbumSummary, Track } from "@/lib/music/models";

import { LibraryClientError } from "./libraryClient";
import { useLibraryMutations } from "./LibraryMutationProvider";
import styles from "./LibraryActionButton.module.css";

type LibraryActionButtonProps = {
  entity: Track | AlbumSummary;
  kind: "track" | "album";
  size?: "md" | "lg";
};

export function LibraryActionButton({ entity, kind, size = "md" }: LibraryActionButtonProps) {
  const {
    isAlbumCollected,
    isTrackLiked,
    setAlbumCollected,
    setTrackLiked,
  } = useLibraryMutations();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = kind === "track"
    ? isTrackLiked(entity.id)
    : isAlbumCollected(entity.id);
  const isActive = active === true;
  const label = kind === "track"
    ? (isActive ? `取消喜欢 ${entity.name}` : `喜欢 ${entity.name}`)
    : (isActive ? `取消收藏专辑 ${entity.name}` : `收藏专辑 ${entity.name}`);

  const handleClick = (): void => {
    if (pending || active === null) {
      return;
    }
    setPending(true);
    setError(null);
    const request = kind === "track"
      ? setTrackLiked(entity as Track, !isActive)
      : setAlbumCollected(entity, !isActive);
    void request.catch((caught: unknown) => {
      setError(caught instanceof LibraryClientError
        ? caught.message
        : "音乐库操作未完成，请稍后重试。");
    }).finally(() => setPending(false));
  };

  return (
    <span className={styles.container}>
      <IconButton
        aria-busy={pending || undefined}
        disabled={pending || active === null}
        icon={kind === "track"
          ? <Heart aria-hidden="true" fill={isActive ? "currentColor" : "none"} />
          : <Bookmark aria-hidden="true" fill={isActive ? "currentColor" : "none"} />}
        label={label}
        loading={pending || active === null}
        onClick={handleClick}
        pressed={isActive}
        size={size}
        tooltip={kind === "track" ? (isActive ? "取消喜欢" : "喜欢") : (isActive ? "取消收藏" : "收藏专辑")}
      />
      {error ? <span aria-live="polite" className={styles.error} role="alert">{error}</span> : null}
    </span>
  );
}
