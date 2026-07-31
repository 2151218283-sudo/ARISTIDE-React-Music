"use client";

import { ArrowLeft, Heart, Pause, Play, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { AlbumArtwork } from "@/components/AlbumArtwork";
import { IconButton } from "@/components/IconButton";
import type { Track, TrackAvailability } from "@/lib/music/models";
import type { PlayerPublicSnapshot } from "@/features/player/playerContext";
import {
  usePlayerDispatch,
  usePlayerSelector,
} from "@/features/player/playerContext";
import { formatPlayerTime } from "@/features/player/playerView";

import { useTrackPreviewDetails } from "./useTrackPreviewDetails";
import styles from "./TrackPreviewStage.module.css";

export type TrackPreviewPhase = "hidden" | "entering" | "visible" | "exiting";

interface TrackPreviewStageProps {
  index: number;
  onClose: () => void;
  onExplore: (track: Track) => void;
  phase: Exclude<TrackPreviewPhase, "hidden">;
  showDomArtwork: boolean;
  total: number;
  track: Track;
  tracks: readonly Track[];
}

const selectCurrentTrackId = (snapshot: PlayerPublicSnapshot) => (
  snapshot.currentTrack?.id ?? null
);
const selectDesiredPlayback = (snapshot: PlayerPublicSnapshot) => snapshot.desiredPlayback;

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

function lyricSummary(
  lyrics: ReturnType<typeof useTrackPreviewDetails>["lyrics"],
): string[] {
  if (lyrics.status === "loading" || lyrics.status === "idle") {
    return ["正在读取歌词…"];
  }
  if (lyrics.status === "error") {
    return ["歌词摘要暂时不可用。"];
  }
  if (!lyrics.data || lyrics.data.kind === "unavailable") {
    return ["暂无歌词。"];
  }
  if (lyrics.data.kind === "instrumental") {
    return ["纯音乐，请专注聽觉。"];
  }

  const lines = lyrics.data.lines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .slice(0, 3);
  return lines.length > 0 ? lines : ["暂无可显示的歌词。"];
}

export function TrackPreviewStage({
  index,
  onClose,
  onExplore,
  phase,
  showDomArtwork,
  total,
  track,
  tracks,
}: TrackPreviewStageProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const animationFrameRef = useRef(0);
  const [activated, setActivated] = useState(false);
  const details = useTrackPreviewDetails(track.id, phase !== "exiting");
  const resolvedTrack = details.track.data ?? track;
  const currentTrackId = usePlayerSelector(selectCurrentTrackId);
  const desiredPlayback = usePlayerSelector(selectDesiredPlayback);
  const dispatch = usePlayerDispatch();
  const isCurrentTrack = currentTrackId === resolvedTrack.id;
  const isPlayingIntent = isCurrentTrack && desiredPlayback === "playing";
  const restriction = unavailableReason(resolvedTrack.availability);
  const summary = useMemo(() => lyricSummary(details.lyrics), [details.lyrics]);

  useEffect(() => {
    window.cancelAnimationFrame(animationFrameRef.current);

    if (phase === "exiting") {
      animationFrameRef.current = window.requestAnimationFrame(() => {
        setActivated(false);
      });
      return () => window.cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      setActivated(false);
      animationFrameRef.current = window.requestAnimationFrame(() => {
        setActivated(true);
        headingRef.current?.focus({ preventScroll: true });
      });
    });

    return () => window.cancelAnimationFrame(animationFrameRef.current);
  }, [phase, track.id]);

  function handlePlayback(): void {
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
      queue: tracks.map((queueTrack, queueIndex) => ({
        queueItemId: `daily:${queueIndex}:${queueTrack.id}`,
        sourceContext: "daily",
        track: queueTrack,
      })),
      track: resolvedTrack,
    });
  }

  return (
    <section
      aria-labelledby={headingId}
      className={styles.stage}
      data-active={activated}
      data-phase={phase}
      data-preview-track-id={track.id}
    >
      <button
        aria-label="关闭歌曲预览，返回每日推荐"
        className={styles.counter}
        onClick={onClose}
        type="button"
      >
        {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </button>

      <IconButton
        className={styles.backButton}
        icon={<ArrowLeft aria-hidden="true" />}
        label="返回每日推荐"
        onClick={onClose}
        size="lg"
        tooltip="返回"
      />

      {showDomArtwork ? (
        <div className={styles.domArtwork} data-testid="preview-dom-artwork">
          <AlbumArtwork
            alt={`${resolvedTrack.name} 封面`}
            priority
            src={resolvedTrack.artworkUrl}
            status={resolvedTrack.artworkUrl ? "idle" : "empty"}
            variant="preview"
          />
        </div>
      ) : null}

      <div className={styles.content}>
        <div className={styles.metadata}>
          <p className={styles.eyebrow}>
            DAILY FORM <span aria-hidden="true">/</span> {availabilityLabel(resolvedTrack.availability)}
          </p>
          <h1
            className={styles.title}
            data-script={titleScript(resolvedTrack.name)}
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
          >
            {resolvedTrack.name}
          </h1>
          <p className={styles.artists}>
            {resolvedTrack.artists.map((artist) => artist.name).join(" / ") || "未知音乐人"}
          </p>
          <dl className={styles.facts}>
            <div>
              <dt>ALBUM</dt>
              <dd>{resolvedTrack.album.name || "未知专辑"}</dd>
            </div>
            <div>
              <dt>TIME</dt>
              <dd>{formatPlayerTime(resolvedTrack.durationMs)}</dd>
            </div>
          </dl>

          <div aria-live="polite" className={styles.detailStatus}>
            {details.track.status === "loading" || details.track.status === "idle"
              ? <span>正在补全歌曲信息…</span>
              : null}
            {details.track.status === "error" ? (
              <span className={styles.errorLine}>
                <span>{details.track.error?.message ?? "暂时无法读取歌曲详情。"}</span>
                <button className={styles.retryButton} onClick={details.retry} type="button">
                  <RefreshCw aria-hidden="true" />
                  <span>重试</span>
                </button>
              </span>
            ) : null}
          </div>
        </div>

        <blockquote aria-label="歌词摘要" className={styles.lyrics}>
          {summary.map((line, lineIndex) => (
            <p key={`${lineIndex}:${line}`}>{line}</p>
          ))}
        </blockquote>

        <div className={styles.controls}>
          <IconButton
            disabled={Boolean(restriction)}
            icon={isPlayingIntent
              ? <Pause aria-hidden="true" fill="currentColor" />
              : <Play aria-hidden="true" fill="currentColor" />}
            label={restriction ?? (isPlayingIntent ? `暂停 ${resolvedTrack.name}` : `播放 ${resolvedTrack.name}`)}
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
          <Link
            aria-label={`打开 ${resolvedTrack.name} 的完整播放页`}
            className={styles.explore}
            href={`/track/${encodeURIComponent(resolvedTrack.id)}`}
            onClick={() => onExplore(resolvedTrack)}
          >
            EXPLORE
          </Link>
        </div>
        {restriction ? <p className={styles.restriction}>{restriction}</p> : null}
      </div>
    </section>
  );
}
