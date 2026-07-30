"use client";

import {
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from "lucide-react";

import { IconButton } from "@/components/IconButton";

import { usePlayerDispatch, usePlayerSelector } from "./playerContext";
import {
  nextPlaybackMode,
  playbackModeLabel,
} from "./playerView";
import styles from "./PersistentPlayerBar.module.css";

export function PlayerTransport() {
  const canNext = usePlayerSelector((snapshot) => snapshot.canNext);
  const canPrevious = usePlayerSelector((snapshot) => snapshot.canPrevious);
  const currentTrack = usePlayerSelector((snapshot) => snapshot.currentTrack);
  const desiredPlayback = usePlayerSelector((snapshot) => snapshot.desiredPlayback);
  const error = usePlayerSelector((snapshot) => snapshot.error);
  const mode = usePlayerSelector((snapshot) => snapshot.mode);
  const networkStatus = usePlayerSelector((snapshot) => snapshot.networkStatus);
  const playbackStatus = usePlayerSelector((snapshot) => snapshot.playbackStatus);
  const dispatch = usePlayerDispatch();
  const wantsPause = desiredPlayback === "playing";
  const busy = playbackStatus === "loading"
    || networkStatus === "buffering"
    || networkStatus === "stalled";
  const fatalError = playbackStatus === "error" && error?.fatal;
  const trackName = currentTrack?.name ?? "当前歌曲";
  const nextMode = nextPlaybackMode(mode);
  const ModeIcon = mode === "shuffle"
    ? Shuffle
    : mode === "repeat-one"
      ? Repeat1
      : Repeat;

  return (
    <div className={styles.transport} aria-label="播放控制" role="group">
      <IconButton
        className={styles.modeButton}
        icon={<ModeIcon />}
        label={`当前${playbackModeLabel(mode)}，切换为${playbackModeLabel(nextMode)}`}
        onClick={() => dispatch({ type: "SET_MODE", mode: nextMode })}
        pressed={mode !== "sequential"}
        size="md"
      />
      <IconButton
        disabled={!canPrevious}
        icon={<SkipBack />}
        label={`上一首，当前《${trackName}》`}
        onClick={() => dispatch({ type: "PREVIOUS" })}
        size="md"
        tooltip={canPrevious ? undefined : "已在队列开头"}
      />
      <button
        aria-busy={busy || undefined}
        aria-label={`${wantsPause ? "暂停" : "播放"}《${trackName}》`}
        className={styles.playButton}
        data-busy={busy || undefined}
        disabled={!currentTrack || Boolean(fatalError)}
        onClick={() => dispatch(wantsPause
          ? { type: "PAUSE", reason: "user" }
          : { type: "PLAY" })}
        title={fatalError ? "请先重试或播放下一首" : undefined}
        type="button"
      >
        {wantsPause ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        {busy ? <span className={styles.busyRing} aria-hidden="true" /> : null}
      </button>
      <IconButton
        disabled={!canNext}
        icon={<SkipForward />}
        label={`下一首，当前《${trackName}》`}
        onClick={() => dispatch({ type: "NEXT", origin: "user" })}
        size="md"
        tooltip={canNext ? undefined : "队列中没有下一首"}
      />
    </div>
  );
}
