"use client";

import { Pause, Play } from "lucide-react";
import Link from "next/link";

import { AlbumArtwork } from "@/components/AlbumArtwork";
import { IconButton } from "@/components/IconButton";
import { usePlayerDispatch, usePlayerSelector } from "@/features/player/playerContext";
import type { QueueItem } from "@/lib/player";
import type { Track } from "@/lib/music/models";

import styles from "./SearchTrackRow.module.css";

export interface SearchTrackRowProps {
  queue: readonly QueueItem[];
  track: Track;
}

export function formatTrackDuration(durationMs: number): string {
  const safeSeconds = Math.max(0, Math.round(durationMs / 1_000));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function unavailableReason(track: Track): string | null {
  switch (track.availability) {
    case "vip":
      return "该歌曲需要相应会员权限";
    case "copyright":
      return "歌曲因版权原因不可用";
    case "region":
      return "当前地区不可播放";
    case "unknown":
      return "当前歌曲暂时不可播放";
    case "playable":
      return null;
  }
}

export function SearchTrackRow({ queue, track }: SearchTrackRowProps) {
  const dispatch = usePlayerDispatch();
  const currentTrack = usePlayerSelector((snapshot) => snapshot.currentTrack);
  const desiredPlayback = usePlayerSelector((snapshot) => snapshot.desiredPlayback);
  const playbackStatus = usePlayerSelector((snapshot) => snapshot.playbackStatus);
  const networkStatus = usePlayerSelector((snapshot) => snapshot.networkStatus);
  const restriction = unavailableReason(track);
  const isCurrent = currentTrack?.id === track.id;
  const isPlaying = isCurrent && desiredPlayback === "playing";
  const isLoading = isCurrent && (
    playbackStatus === "loading"
    || networkStatus === "buffering"
    || networkStatus === "stalled"
  );
  const artistNames = track.artists.map((artist) => artist.name).join(" / ");

  const handlePlayback = (): void => {
    if (restriction) {
      return;
    }

    if (isCurrent) {
      dispatch(isPlaying
        ? { type: "PAUSE", reason: "user" }
        : { type: "PLAY" });
      return;
    }

    dispatch({
      type: "LOAD_TRACK",
      autoplay: true,
      queue,
      track,
    });
  };

  const statusLabel = restriction
    ?? (isPlaying ? "正在播放" : isCurrent ? "已载入播放器" : null);

  return (
    <article className={styles.row} data-current={isCurrent || undefined}>
      <Link
        aria-label={`查看 ${track.name} 的完整播放页`}
        className={styles.trackLink}
        href={`/track/${encodeURIComponent(track.id)}`}
      >
        <AlbumArtwork
          alt={`${track.name} - ${track.album.name} 封面`}
          playing={isPlaying}
          src={track.artworkUrl}
          status={track.artworkUrl ? "loaded" : "empty"}
          variant="thumbnail"
        />
        <span className={styles.primaryCopy}>
          <span className={styles.titleLine}>
            <span className={styles.title}>{track.name}</span>
            {track.aliases[0] ? <span className={styles.alias}>({track.aliases[0]})</span> : null}
          </span>
          <span className={styles.artist}>{artistNames}</span>
        </span>
        <span className={styles.album}>{track.album.name}</span>
        <span className={styles.duration}>{formatTrackDuration(track.durationMs)}</span>
      </Link>
      <span className={styles.playback}>
        {statusLabel ? <span className={styles.status}>{statusLabel}</span> : null}
        <IconButton
          disabled={Boolean(restriction)}
          icon={isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          label={restriction ?? (isPlaying ? `暂停 ${track.name}` : `播放 ${track.name}`)}
          loading={isLoading}
          onClick={handlePlayback}
          pressed={isPlaying}
          size="md"
          tooltip={restriction ?? (isPlaying ? "暂停" : "播放")}
        />
      </span>
    </article>
  );
}
