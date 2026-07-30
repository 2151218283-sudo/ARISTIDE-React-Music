"use client";

import { Volume2, VolumeX } from "lucide-react";

import { IconButton } from "@/components/IconButton";

import { usePlayerDispatch, usePlayerSelector } from "./playerContext";
import styles from "./PersistentPlayerBar.module.css";

export function VolumeControl() {
  const muted = usePlayerSelector((snapshot) => snapshot.muted);
  const volume = usePlayerSelector((snapshot) => snapshot.volume);
  const dispatch = usePlayerDispatch();
  const audible = !muted && volume > 0;

  const toggleMute = (): void => {
    if (audible) {
      dispatch({ type: "SET_MUTED", muted: true });
      return;
    }
    if (volume === 0) {
      dispatch({ type: "SET_VOLUME", volume: 0.7 });
    }
    if (muted) {
      dispatch({ type: "SET_MUTED", muted: false });
    }
  };

  return (
    <div className={styles.volume} aria-label="音量控制" role="group">
      <IconButton
        icon={audible ? <Volume2 /> : <VolumeX />}
        label={audible ? "静音" : "恢复音量"}
        onClick={toggleMute}
        pressed={!audible}
        size="md"
      />
      <label className={styles.srOnly} htmlFor="echoform-player-volume">
        音量
      </label>
      <input
        aria-label="音量"
        aria-valuetext={`${Math.round(volume * 100)}%`}
        className={styles.volumeRange}
        id="echoform-player-volume"
        max={1}
        min={0}
        onChange={(event) => {
          const nextVolume = Number(event.currentTarget.value);
          dispatch({ type: "SET_VOLUME", volume: nextVolume });
          if (muted && nextVolume > 0) {
            dispatch({ type: "SET_MUTED", muted: false });
          }
        }}
        step={0.01}
        type="range"
        value={volume}
      />
    </div>
  );
}
