"use client";

import { Pause, Play } from "lucide-react";
import Link from "next/link";

import { usePlayerDispatch, usePlayerSelector } from "@/features/player/playerContext";
import type { Track } from "@/lib/music/models";
import type { QueueItem } from "@/lib/player";

import { AlbumArtwork } from "./AlbumArtwork";
import { IconButton } from "./IconButton";
import styles from "./TrackRow.module.css";

export type TrackRowPlayability =
  | "unknown"
  | "checking"
  | "verified-playable"
  | "unavailable";

export interface TrackRowProps {
  onPlaybackRequested?: (trackId: string) => void;
  playability?: TrackRowPlayability;
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
    case "playable":
      return null;
  }
}

function playabilityLabel(state: TrackRowPlayability): string | null {
  switch (state) {
    case "checking":
      return "正在检查";
    case "unavailable":
      return "当前不可播放";
    case "unknown":
      return "播放时检查";
    case "verified-playable":
      return null;
  }
}

function defaultPlayability(track: Track): TrackRowPlayability {
  return track.availability === "playable"
    ? "verified-playable"
    : track.availability === "unknown"
      ? "unknown"
      : "unavailable";
}

export function TrackRow({
  onPlaybackRequested,
  playability,
  queue,
  track,
}: TrackRowProps) {
  const dispatch = usePlayerDispatch();
  const currentTrack = usePlayerSelector((snapshot) => snapshot.currentTrack);
  const desiredPlayback = usePlayerSelector((snapshot) => snapshot.desiredPlayback);
  const playbackStatus = usePlayerSelector((snapshot) => snapshot.playbackStatus);
  const networkStatus = usePlayerSelector((snapshot) => snapshot.networkStatus);
  const resolvedPlayability = playability ?? defaultPlayability(track);
  const restriction = unavailableReason(track);
  const availabilityLabel = restriction ?? playabilityLabel(resolvedPlayability);
  const isCurrent = currentTrack?.id === track.id;
  const isPlaying = isCurrent && desiredPlayback === "playing";
  const isLoading = isCurrent && (
    playbackStatus === "loading"
    || networkStatus === "buffering"
    || networkStatus === "stalled"
  );
  const artistNames = track.artists.map((artist) => artist.name).join(" / ");

  const handlePlayback = (): void => {
    if (
      restriction
      || resolvedPlayability === "checking"
      || resolvedPlayability === "unavailable"
    ) {
      return;
    }

    if (isCurrent) {
      dispatch(isPlaying
        ? { type: "PAUSE", reason: "user" }
        : { type: "PLAY" });
      return;
    }

    onPlaybackRequested?.(track.id);
    dispatch({
      type: "LOAD_TRACK",
      autoplay: true,
      queue: [...queue],
      track,
    });
  };

  const statusLabel = availabilityLabel
    ?? (isPlaying ? "正在播放" : isCurrent ? "已载入播放器" : null);
  const playbackDisabled = Boolean(restriction)
    || resolvedPlayability === "checking"
    || resolvedPlayability === "unavailable";
  const playbackLabel = isPlaying
    ? `暂停 ${track.name}`
    : resolvedPlayability === "unknown"
      ? `播放并检查 ${track.name}`
      : availabilityLabel
        ? `${availabilityLabel} ${track.name}`
        : `播放 ${track.name}`;

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
          disabled={playbackDisabled}
          icon={isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          label={playbackLabel}
          loading={isLoading || resolvedPlayability === "checking"}
          onClick={handlePlayback}
          pressed={isPlaying}
          size="md"
          tooltip={availabilityLabel ?? (isPlaying ? "暂停" : "播放")}
        />
      </span>
    </article>
  );
}
