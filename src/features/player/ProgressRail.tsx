"use client";

import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import {
  usePlayerDispatch,
  usePlayerSelector,
  usePlayerTimelineSelector,
} from "./playerContext";
import { formatPlayerTime } from "./playerView";
import styles from "./PersistentPlayerBar.module.css";

type ProgressStyle = CSSProperties & {
  "--buffered-ratio": string;
  "--played-ratio": string;
};

function clampTime(timeMs: number, durationMs: number): number {
  return Math.min(Math.max(timeMs, 0), durationMs);
}

export function ProgressRail() {
  const currentTimeMs = usePlayerTimelineSelector((snapshot) => snapshot.currentTimeMs);
  const durationMs = usePlayerSelector((snapshot) => snapshot.durationMs);
  const bufferedUntilMs = usePlayerTimelineSelector((snapshot) => snapshot.bufferedUntilMs);
  const loadRevision = usePlayerSelector((snapshot) => snapshot.loadRevision);
  const dispatch = usePlayerDispatch();
  const labelId = useId();
  const pointerStartTimeRef = useRef<number | null>(null);
  const [preview, setPreview] = useState<{
    revision: number;
    timeMs: number;
  } | null>(null);
  const previewTimeMs = durationMs !== null && preview?.revision === loadRevision
    ? preview.timeMs
    : null;
  const displayTimeMs = previewTimeMs ?? currentTimeMs;
  const maximum = durationMs ?? 0;
  const playedRatio = maximum > 0 ? displayTimeMs / maximum : 0;
  const bufferedRatio = maximum > 0 ? bufferedUntilMs / maximum : 0;
  const style: ProgressStyle = {
    "--buffered-ratio": `${Math.min(Math.max(bufferedRatio, 0), 1) * 100}%`,
    "--played-ratio": `${Math.min(Math.max(playedRatio, 0), 1) * 100}%`,
  };

  const commit = (timeMs: number): void => {
    if (durationMs === null) {
      return;
    }
    const target = clampTime(timeMs, durationMs);
    dispatch({ type: "SEEK_COMMIT", timeMs: target });
    setPreview(null);
  };

  const onPointerDown = (): void => {
    if (durationMs !== null) {
      pointerStartTimeRef.current = currentTimeMs;
      dispatch({ type: "SEEK_START" });
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLInputElement>): void => {
    pointerStartTimeRef.current = null;
    commit(Number(event.currentTarget.value));
  };

  const onPointerCancel = (): void => {
    const restoreTimeMs = pointerStartTimeRef.current;
    pointerStartTimeRef.current = null;
    commit(restoreTimeMs ?? currentTimeMs);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (durationMs === null) {
      return;
    }

    let target: number | null = null;
    const step = event.shiftKey ? 15_000 : 5_000;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      target = currentTimeMs - step;
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      target = currentTimeMs + step;
    } else if (event.key === "Home") {
      target = 0;
    } else if (event.key === "End") {
      target = durationMs;
    }

    if (target !== null) {
      event.preventDefault();
      commit(target);
    }
  };

  return (
    <div className={styles.progress} style={style}>
      <span className={styles.time} aria-hidden="true">
        {formatPlayerTime(displayTimeMs)}
      </span>
      <div className={styles.rail}>
        <span className={styles.railBase} aria-hidden="true" />
        <span className={styles.railBuffered} aria-hidden="true" />
        <span className={styles.railPlayed} aria-hidden="true" />
        <label className={styles.srOnly} id={labelId} htmlFor={`${labelId}-input`}>
          播放进度
        </label>
        <input
          aria-labelledby={labelId}
          aria-valuetext={`${formatPlayerTime(displayTimeMs)} / ${formatPlayerTime(durationMs)}`}
          className={styles.range}
          disabled={durationMs === null}
          id={`${labelId}-input`}
          max={maximum}
          min={0}
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            setPreview({ revision: loadRevision, timeMs: value });
            dispatch({ type: "SEEK_PREVIEW", timeMs: value });
          }}
          onKeyDown={onKeyDown}
          onPointerCancel={onPointerCancel}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          step={1_000}
          type="range"
          value={displayTimeMs}
        />
      </div>
      <span className={styles.time} aria-hidden="true">
        {formatPlayerTime(durationMs)}
      </span>
    </div>
  );
}
