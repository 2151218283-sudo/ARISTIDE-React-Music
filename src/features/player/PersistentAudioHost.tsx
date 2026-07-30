"use client";

import { useEffect } from "react";

import type { PlayerEvent, PlayerSnapshot } from "@/lib/player";

import { usePlayerRuntime } from "./playerContext";
import styles from "./PersistentAudioHost.module.css";

const HAVE_FUTURE_DATA = 3;
const STALL_DETECTION_MS = 3_000;
const STALL_RECOVERY_MS = 7_000;

type RevisionedPlayerEvent = Extract<PlayerEvent, { revision: number }>;
type WithoutRevision<T> = T extends RevisionedPlayerEvent
  ? Omit<T, "revision">
  : never;
type PlayerMediaEvent = WithoutRevision<RevisionedPlayerEvent>;

function bufferedUntilMs(audio: HTMLAudioElement): number {
  let bufferedSeconds = 0;
  for (let index = 0; index < audio.buffered.length; index += 1) {
    bufferedSeconds = Math.max(bufferedSeconds, audio.buffered.end(index));
  }
  return bufferedSeconds * 1_000;
}

export function PersistentAudioHost() {
  const { audioRef, connectAudio, controller } = usePlayerRuntime();

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }

    let appliedRevision = controller.getSnapshot().loadRevision;
    let appliedSourceUrl: string | null = null;
    let animationFrame: number | null = null;
    let stallInterval: number | null = null;
    let recoveryTimeout: number | null = null;
    let lastProgressAt = performance.now();
    let lastObservedTime = audio.currentTime;
    let latestSnapshot = controller.getSnapshot();
    const reducedMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;

    const dispatchMedia = (
      event: PlayerMediaEvent,
      revision = appliedRevision,
    ): void => {
      controller.dispatch({ ...event, revision } as PlayerEvent);
    };

    const stopAnimationFrame = (): void => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    };

    const projectTime = (): void => {
      const currentTimeMs = audio.currentTime * 1_000;
      dispatchMedia({ type: "MEDIA_TIME", currentTimeMs });
      if (audio.currentTime !== lastObservedTime) {
        lastObservedTime = audio.currentTime;
        lastProgressAt = performance.now();
      }
    };

    const runAnimationFrame = (): void => {
      projectTime();
      animationFrame = window.requestAnimationFrame(runAnimationFrame);
    };

    const syncAnimationFrame = (): void => {
      const shouldRun = latestSnapshot.playbackStatus === "playing"
        && latestSnapshot.seekStatus !== "seeking"
        && document.visibilityState === "visible"
        && !reducedMotionQuery?.matches;
      if (shouldRun && animationFrame === null) {
        animationFrame = window.requestAnimationFrame(runAnimationFrame);
      } else if (!shouldRun) {
        stopAnimationFrame();
      }
    };

    const clearRecoveryTimeout = (): void => {
      if (recoveryTimeout !== null) {
        window.clearTimeout(recoveryTimeout);
        recoveryTimeout = null;
      }
    };

    const syncRecoveryTimeout = (): void => {
      if (latestSnapshot.networkStatus !== "stalled") {
        clearRecoveryTimeout();
        return;
      }
      if (recoveryTimeout === null) {
        recoveryTimeout = window.setTimeout(() => {
          recoveryTimeout = null;
          controller.recoverStall();
        }, STALL_RECOVERY_MS);
      }
    };

    const clearAudioSource = (revision: number): void => {
      appliedRevision = revision;
      appliedSourceUrl = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.removeAttribute("crossorigin");
      audio.load();
      lastObservedTime = 0;
      lastProgressAt = performance.now();
    };

    const applySource = (snapshot: PlayerSnapshot): void => {
      const source = snapshot.source;

      if (!snapshot.currentTrack) {
        if (appliedSourceUrl !== null || audio.hasAttribute("src")) {
          clearAudioSource(snapshot.loadRevision);
        } else {
          appliedRevision = snapshot.loadRevision;
        }
        return;
      }

      if (!source) {
        if (snapshot.playbackStatus === "loading"
          && (appliedRevision !== snapshot.loadRevision || appliedSourceUrl !== null)) {
          clearAudioSource(snapshot.loadRevision);
        }
        return;
      }

      if (appliedRevision === snapshot.loadRevision
        && appliedSourceUrl === source.url) {
        return;
      }

      appliedRevision = snapshot.loadRevision;
      appliedSourceUrl = source.url;
      if (source.corsMode === "anonymous") {
        audio.crossOrigin = "anonymous";
      } else {
        audio.removeAttribute("crossorigin");
      }
      audio.src = source.url;
      audio.load();
      lastObservedTime = 0;
      lastProgressAt = performance.now();
    };

    const syncOutputVolume = (snapshot: PlayerSnapshot): void => {
      audio.muted = snapshot.muted;
      audio.volume = Math.min(
        1,
        Math.max(0, snapshot.volume * snapshot.sleepFadeGain),
      );
    };

    const syncFromSnapshot = (snapshot: PlayerSnapshot): void => {
      latestSnapshot = snapshot;
      applySource(snapshot);
      syncOutputVolume(snapshot);
      syncAnimationFrame();
      syncRecoveryTimeout();
    };

    const onLoadedMetadata = (): void => {
      const durationMs = Number.isFinite(audio.duration)
        ? Math.max(0, audio.duration * 1_000)
        : null;
      if (durationMs === null) {
        return;
      }
      const restoreMs = controller.getSnapshot().currentTimeMs;
      if (restoreMs > 0) {
        audio.currentTime = Math.min(restoreMs, durationMs) / 1_000;
      }
      dispatchMedia({ type: "MEDIA_LOADEDMETADATA", durationMs });
    };
    const onCanPlay = (): void => dispatchMedia({ type: "MEDIA_CANPLAY" });
    const onPlay = (): void => dispatchMedia({ type: "MEDIA_PLAY" });
    const onPause = (): void => dispatchMedia({ type: "MEDIA_PAUSE" });
    const onWaiting = (): void => dispatchMedia({ type: "MEDIA_WAITING" });
    const onStalled = (): void => dispatchMedia({ type: "MEDIA_STALLED" });
    const onSeeked = (): void => dispatchMedia({ type: "MEDIA_SEEKED" });
    const onProgress = (): void => dispatchMedia({
      type: "MEDIA_PROGRESS",
      bufferedUntilMs: bufferedUntilMs(audio),
    });
    const onTimeUpdate = (): void => {
      if (animationFrame === null && latestSnapshot.seekStatus !== "seeking") {
        projectTime();
      }
    };
    const onEnded = (): void => {
      const before = controller.getSnapshot();
      if (before.mode === "repeat-one"
        && before.sleepTimer?.kind !== "end-of-track") {
        audio.currentTime = 0;
      }
      dispatchMedia({ type: "MEDIA_ENDED" });
    };
    const onError = (): void => dispatchMedia({
      type: "MEDIA_ERROR",
      mediaCode: audio.error?.code ?? null,
    });
    const onVisibilityChange = (): void => syncAnimationFrame();
    const onMotionChange = (): void => syncAnimationFrame();

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("progress", onProgress);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("seeked", onSeeked);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotionQuery?.addEventListener("change", onMotionChange);

    stallInterval = window.setInterval(() => {
      const snapshot = controller.getSnapshot();
      if (snapshot.desiredPlayback !== "playing"
        || snapshot.seekStatus === "seeking"
        || snapshot.networkStatus === "stalled") {
        return;
      }

      if (audio.currentTime !== lastObservedTime) {
        lastObservedTime = audio.currentTime;
        lastProgressAt = performance.now();
        return;
      }

      if (audio.readyState < HAVE_FUTURE_DATA
        && performance.now() - lastProgressAt >= STALL_DETECTION_MS) {
        dispatchMedia({ type: "MEDIA_STALLED" });
      }
    }, 500);

    const unsubscribe = controller.subscribe(syncFromSnapshot);
    syncFromSnapshot(latestSnapshot);

    return () => {
      unsubscribe();
      stopAnimationFrame();
      clearRecoveryTimeout();
      if (stallInterval !== null) {
        window.clearInterval(stallInterval);
      }
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("progress", onProgress);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotionQuery?.removeEventListener("change", onMotionChange);
    };
  }, [audioRef, controller]);

  return (
    <audio
      aria-hidden="true"
      className={styles.audio}
      data-echoform-audio
      preload="metadata"
      ref={connectAudio}
      tabIndex={-1}
    />
  );
}
