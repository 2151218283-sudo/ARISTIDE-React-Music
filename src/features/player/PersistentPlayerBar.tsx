"use client";

import { AlbumArtwork } from "@/components/AlbumArtwork";
import { TextButton } from "@/components/TextButton";

import { usePlayerDispatch, usePlayerSelector } from "./playerContext";
import { PlayerTransport } from "./PlayerTransport";
import { playerStatusLabel } from "./playerView";
import { ProgressRail } from "./ProgressRail";
import styles from "./PersistentPlayerBar.module.css";
import { VolumeControl } from "./VolumeControl";

export function PersistentPlayerBar() {
  const currentTrack = usePlayerSelector((snapshot) => snapshot.currentTrack);
  const error = usePlayerSelector((snapshot) => snapshot.error);
  const networkStatus = usePlayerSelector((snapshot) => snapshot.networkStatus);
  const playbackStatus = usePlayerSelector((snapshot) => snapshot.playbackStatus);
  const queueLength = usePlayerSelector((snapshot) => snapshot.queue.length);
  const dispatch = usePlayerDispatch();

  if (!currentTrack) {
    return (
      <section
        aria-label="播放器"
        className={styles.bar}
        data-player-visible="false"
        data-state="idle"
        hidden
      />
    );
  }

  const artistNames = currentTrack.artists.map((artist) => artist.name).join(" / ");
  const status = playerStatusLabel({
    error,
    networkStatus,
    playbackStatus,
    queueLength,
  });

  return (
    <>
      <div className={styles.spacer} aria-hidden="true" data-player-spacer />
      <section
        aria-label="播放器"
        className={styles.bar}
        data-network={networkStatus}
        data-player-visible="true"
        data-state={playbackStatus}
      >
        <div className={styles.inner}>
          <div className={styles.identity}>
            <AlbumArtwork
              alt={`${currentTrack.name} 封面`}
              playing={playbackStatus === "playing"}
              src={currentTrack.artworkUrl}
              status={currentTrack.artworkUrl ? "loaded" : "empty"}
              variant="thumbnail"
            />
            <div className={styles.trackText}>
              <p className={styles.trackName} title={currentTrack.name}>
                {currentTrack.name}
              </p>
              <p
                className={error && playbackStatus === "error"
                  ? styles.errorText
                  : styles.trackMeta}
                title={status}
              >
                {error && playbackStatus === "error" ? status : artistNames}
              </p>
            </div>
            {error?.retryable && playbackStatus === "error" ? (
              <TextButton
                className={styles.retryButton}
                onClick={() => dispatch({ type: "RETRY" })}
                variant="quiet"
              >
                重试
              </TextButton>
            ) : null}
          </div>
          <PlayerTransport />
          <VolumeControl />
          <ProgressRail />
        </div>
        <p aria-live="polite" className={styles.srOnly}>
          {status}
        </p>
      </section>
    </>
  );
}
