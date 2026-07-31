"use client";

import {
  CircleAlert,
  Heart,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import { useMemo } from "react";

import { AlbumArtwork } from "@/components/AlbumArtwork";
import { IconButton } from "@/components/IconButton";
import { Skeleton } from "@/components/Skeleton";
import { StatusView } from "@/components/StatusView";
import { TextButton } from "@/components/TextButton";
import type { Track, TrackAvailability } from "@/lib/music/models";

import { LyricsViewport } from "./LyricsViewport";
import { CommentsQueuePanel } from "./CommentsQueuePanel";
import { usePlayerDispatch, usePlayerSelector } from "./playerContext";
import { formatPlayerTime, playerStatusLabel } from "./playerView";
import styles from "./TrackPlayerPage.module.css";
import { useTrackPageDetails } from "./useTrackPageDetails";

function availabilityLabel(availability: TrackAvailability): string {
  if (availability === "playable") {
    return "可播放";
  }
  if (availability === "vip") {
    return "VIP 限制";
  }
  if (availability === "copyright") {
    return "版权限制";
  }
  if (availability === "region") {
    return "地区限制";
  }
  return "待验证";
}

function unavailableReason(availability: TrackAvailability): string | null {
  if (availability === "vip") {
    return "该歌曲需要 VIP 权益，目前无法播放。";
  }
  if (availability === "copyright") {
    return "该歌曲因版权限制暂不可播放。";
  }
  if (availability === "region") {
    return "该歌曲在当前地区暂不可播放。";
  }
  return null;
}

function titleScript(name: string): "cjk" | "latin" {
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(name)
    ? "cjk"
    : "latin";
}

function TrackPageSkeleton() {
  return (
    <section aria-label="完整播放页加载中" className={styles.page} data-track-page-state="loading">
      <div className={styles.skeletonStage}>
        <Skeleton className={styles.skeletonArtwork} label="正在读取歌曲信息" variant="artwork" />
        <div className={styles.skeletonMetadata}>
          <Skeleton variant="line-short" />
          <Skeleton className={styles.skeletonTitle} variant="line" />
          <Skeleton variant="line-short" />
          <Skeleton className={styles.skeletonControl} variant="button" />
        </div>
        <div className={styles.skeletonLyrics}>
          <Skeleton variant="line-short" />
          <Skeleton variant="line" />
          <Skeleton variant="line-short" />
          <Skeleton variant="line" />
        </div>
      </div>
    </section>
  );
}

function TrackPageError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <section className={styles.page} data-track-page-state="error">
      <StatusView
        action={{ label: "重试", onClick: onRetry }}
        description={message}
        title="歌曲详情未能加载"
        tone="error"
        variant="page"
      />
    </section>
  );
}

function TrackPagePlayback({ track }: { track: Track }) {
  const currentTrack = usePlayerSelector((snapshot) => snapshot.currentTrack);
  const desiredPlayback = usePlayerSelector((snapshot) => snapshot.desiredPlayback);
  const error = usePlayerSelector((snapshot) => snapshot.error);
  const networkStatus = usePlayerSelector((snapshot) => snapshot.networkStatus);
  const playbackStatus = usePlayerSelector((snapshot) => snapshot.playbackStatus);
  const queueLength = usePlayerSelector((snapshot) => snapshot.queue.length);
  const dispatch = usePlayerDispatch();
  const restriction = unavailableReason(track.availability);
  const isCurrentTrack = currentTrack?.id === track.id;
  const isPlayingIntent = isCurrentTrack && desiredPlayback === "playing";
  const isCurrentError = isCurrentTrack && playbackStatus === "error" && error !== null;
  const busy = isCurrentTrack && (
    playbackStatus === "loading"
    || networkStatus === "buffering"
    || networkStatus === "stalled"
  );
  const status = isCurrentTrack
    ? playerStatusLabel({ error, networkStatus, playbackStatus, queueLength })
    : "尚未载入播放器";

  const handlePlayback = (): void => {
    if (restriction) {
      return;
    }

    if (isCurrentTrack) {
      dispatch(isPlayingIntent
        ? { type: "PAUSE", reason: "user" }
        : { type: "PLAY" });
      return;
    }

    dispatch({
      type: "LOAD_TRACK",
      autoplay: true,
      queue: [{
        queueItemId: `track-page:${track.id}`,
        sourceContext: "manual",
        track,
      }],
      track,
    });
  };

  return (
    <div className={styles.playback}>
      <div className={styles.primaryControls}>
        <IconButton
          disabled={Boolean(restriction) || Boolean(isCurrentError)}
          icon={isPlayingIntent
            ? <Pause aria-hidden="true" fill="currentColor" />
            : <Play aria-hidden="true" fill="currentColor" />}
          label={restriction ?? (isPlayingIntent ? `暂停 ${track.name}` : `播放 ${track.name}`)}
          loading={busy}
          onClick={handlePlayback}
          pressed={isPlayingIntent}
          size="lg"
          tooltip={restriction ?? (isPlayingIntent ? "暂停" : "播放")}
        />
        <IconButton
          disabled
          icon={<Heart aria-hidden="true" />}
          label="喜欢功能尚未开放"
          size="lg"
          tooltip="喜欢功能尚未开放"
        />
      </div>
      <p aria-live="polite" className={styles.playbackStatus} data-busy={busy || undefined}>
        {status}
      </p>
      {restriction ? <p className={styles.restriction}>{restriction}</p> : null}
      {isCurrentError ? (
        <div className={styles.playerError} data-player-error role="alert">
          <CircleAlert aria-hidden="true" />
          <span>{error.message}</span>
          {error.retryable ? (
            <TextButton
              className={styles.retryButton}
              onClick={() => dispatch({ type: "RETRY" })}
              variant="quiet"
            >
              <RefreshCw aria-hidden="true" />
              重试
            </TextButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface TrackPlayerPageProps {
  trackId: string;
}

export function TrackPlayerPage({ trackId }: TrackPlayerPageProps) {
  const details = useTrackPageDetails(trackId);
  const track = details.track.data;
  const artistNames = useMemo(
    () => track?.artists.map((artist) => artist.name).join(" / ") ?? "",
    [track],
  );

  if (details.track.status === "idle" || details.track.status === "loading") {
    return <TrackPageSkeleton />;
  }

  if (details.track.status === "error" || !track) {
    return (
      <TrackPageError
        message={details.track.error?.message ?? "暂时无法读取歌曲详情。"}
        onRetry={details.track.retry}
      />
    );
  }

  return (
    <section
      className={styles.page}
      data-track-page-state="ready"
      data-track-id={track.id}
    >
      <header className={styles.header}>
        <p>NOW PLAYING</p>
        <span>{availabilityLabel(track.availability)}</span>
      </header>
      <div className={styles.stage}>
        <div className={styles.artworkColumn}>
          <AlbumArtwork
            alt={`${track.name} 封面`}
            className={styles.artwork}
            playing={false}
            priority
            src={track.artworkUrl}
            status={track.artworkUrl ? "loaded" : "empty"}
            variant="player"
          />
        </div>
        <section className={styles.metadata} aria-labelledby="track-page-title">
          <p className={styles.album}>{track.album.name || "未知专辑"}</p>
          <h1
            data-page-heading
            data-script={titleScript(track.name)}
            id="track-page-title"
            tabIndex={-1}
          >
            {track.name}
          </h1>
          <p className={styles.artists}>{artistNames || "未知音乐人"}</p>
          <dl className={styles.facts}>
            <div>
              <dt>ALBUM</dt>
              <dd>{track.album.name || "未知专辑"}</dd>
            </div>
            <div>
              <dt>TIME</dt>
              <dd>{formatPlayerTime(track.durationMs)}</dd>
            </div>
          </dl>
          <TrackPagePlayback track={track} />
          <CommentsQueuePanel trackId={track.id} />
        </section>
        <LyricsViewport lyrics={details.lyrics} />
      </div>
    </section>
  );
}
