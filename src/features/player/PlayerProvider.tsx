"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  createPlayerController,
  type PlayerCommand,
  type PlayerSnapshot,
  type PlayerSourceResolver,
} from "@/lib/player";
import { defaultSettings } from "@/features/settings/settingsModel";
import { useOptionalSettings } from "@/features/settings/SettingsProvider";

import { PersistentAudioHost } from "./PersistentAudioHost";
import { PersistentPlayerBar } from "./PersistentPlayerBar";
import {
  PlayerRuntimeContext,
  type PlayerPublicSnapshot,
  type PlayerRuntimeContextValue,
  type PlayerTimelineSnapshot,
} from "./playerContext";
import { resolvePlaybackSource } from "./sourceClient";

interface PlayerProviderProps {
  children: ReactNode;
  sourceResolver?: PlayerSourceResolver;
}

class AudioOutputBridge {
  private element: HTMLAudioElement | null = null;

  connect(element: HTMLAudioElement | null): void {
    this.element = element;
  }

  pause(): void {
    this.element?.pause();
  }

  play(): Promise<void> {
    if (!this.element) {
      const error = new Error("The persistent audio host is not mounted.");
      error.name = "InvalidStateError";
      return Promise.reject(error);
    }
    return this.element.play();
  }
}

function toPublicSnapshot(snapshot: PlayerSnapshot): PlayerPublicSnapshot {
  const {
    bufferedUntilMs: _bufferedUntilMs,
    currentTimeMs: _currentTimeMs,
    loadOrigin: _loadOrigin,
    playbackHistory,
    shuffleBag,
    source,
    ...publicFields
  } = snapshot;
  void _bufferedUntilMs;
  void _currentTimeMs;
  void _loadOrigin;
  const canNext = snapshot.mode === "shuffle"
    ? shuffleBag.length > 0
    : snapshot.currentIndex >= 0
      && snapshot.currentIndex < snapshot.queue.length - 1;
  const canPrevious = snapshot.currentTimeMs > 0
    || snapshot.currentIndex > 0
    || playbackHistory.length > 0;

  return {
    ...publicFields,
    canNext,
    canPrevious,
    hasSource: source !== null,
  };
}

function toTimelineSnapshot(snapshot: PlayerSnapshot): PlayerTimelineSnapshot {
  return {
    bufferedUntilMs: snapshot.bufferedUntilMs,
    currentTimeMs: snapshot.currentTimeMs,
    durationMs: snapshot.durationMs,
    loadRevision: snapshot.loadRevision,
  };
}

function hasSameFields<T extends object>(previous: T, next: T): boolean {
  const previousRecord = previous as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  const previousKeys = Object.keys(previousRecord);
  const nextKeys = Object.keys(nextRecord);

  return previousKeys.length === nextKeys.length
    && previousKeys.every((key) => Object.is(previousRecord[key], nextRecord[key]));
}

class PlayerSubscriptionStore {
  private readonly semanticListeners = new Set<() => void>();
  private readonly timelineListeners = new Set<() => void>();
  private publicSnapshot: PlayerPublicSnapshot;
  private timelineSnapshot: PlayerTimelineSnapshot;
  private unsubscribe: (() => void) | null;

  constructor(controller: ReturnType<typeof createPlayerController>) {
    const initialSnapshot = controller.getSnapshot();
    this.publicSnapshot = toPublicSnapshot(initialSnapshot);
    this.timelineSnapshot = toTimelineSnapshot(initialSnapshot);
    this.unsubscribe = controller.subscribe((snapshot) => this.publish(snapshot));
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.semanticListeners.clear();
    this.timelineListeners.clear();
  }

  getPublicSnapshot(): PlayerPublicSnapshot {
    return this.publicSnapshot;
  }

  getTimelineSnapshot(): PlayerTimelineSnapshot {
    return this.timelineSnapshot;
  }

  subscribe(listener: () => void): () => void {
    this.semanticListeners.add(listener);
    return () => this.semanticListeners.delete(listener);
  }

  subscribeTimeline(listener: () => void): () => void {
    this.timelineListeners.add(listener);
    return () => this.timelineListeners.delete(listener);
  }

  private publish(snapshot: PlayerSnapshot): void {
    const nextPublicSnapshot = toPublicSnapshot(snapshot);
    if (!hasSameFields(this.publicSnapshot, nextPublicSnapshot)) {
      this.publicSnapshot = nextPublicSnapshot;
      this.semanticListeners.forEach((listener) => listener());
    }

    const nextTimelineSnapshot = toTimelineSnapshot(snapshot);
    if (!hasSameFields(this.timelineSnapshot, nextTimelineSnapshot)) {
      this.timelineSnapshot = nextTimelineSnapshot;
      this.timelineListeners.forEach((listener) => listener());
    }
  }
}

export function PlayerProvider({
  children,
  sourceResolver = resolvePlaybackSource,
}: PlayerProviderProps) {
  const settings = useOptionalSettings();
  const hydrated = settings?.hydrated ?? true;
  const preferences = settings?.preferences ?? defaultSettings;
  const setPreference = settings?.setPreference;
  const getPreferences = settings?.getPreferences;
  const audioRef = useRef<HTMLAudioElement>(null);
  const cleanupGenerationRef = useRef(0);
  const [audioOutput] = useState(() => new AudioOutputBridge());

  const [controller] = useState(() => createPlayerController({
    resolveSource: (track, context) => sourceResolver === resolvePlaybackSource
      ? resolvePlaybackSource(track, context, getPreferences?.().quality ?? "standard")
      : sourceResolver(track, context),
    requestPause: () => audioOutput.pause(),
    requestPlay: () => audioOutput.play(),
  }));
  const [subscriptionStore] = useState(() => new PlayerSubscriptionStore(controller));

  useEffect(() => {
    if (!hydrated) return;
    if (controller.getSnapshot().mode !== preferences.mode) {
      controller.dispatch({ type: "SET_MODE", mode: preferences.mode });
    }
    if (controller.getSnapshot().volume !== preferences.volume) {
      controller.dispatch({ type: "SET_VOLUME", volume: preferences.volume });
    }
  }, [controller, hydrated, preferences.mode, preferences.volume]);

  useEffect(() => {
    let scheduledTimer: PlayerSnapshot["sleepTimer"] = null;
    let deadlineTimeout: number | null = null;
    let fadeTimeout: number | null = null;
    let fadeInterval: number | null = null;

    const clearSchedule = (): void => {
      if (deadlineTimeout !== null) window.clearTimeout(deadlineTimeout);
      if (fadeTimeout !== null) window.clearTimeout(fadeTimeout);
      if (fadeInterval !== null) window.clearInterval(fadeInterval);
      deadlineTimeout = null;
      fadeTimeout = null;
      fadeInterval = null;
    };
    const pulse = (): void => {
      const timer = scheduledTimer;
      if (!timer || timer.kind !== "after-duration"
        || controller.getSnapshot().sleepTimer !== timer) return;
      const now = Date.now();
      if (now >= timer.firesAt) {
        controller.dispatch({ type: "SLEEP_TIMER_FIRED" });
      } else if (timer.firesAt - now <= 3_000) {
        controller.dispatch({ type: "SLEEP_TIMER_TICK", now });
      }
    };
    const syncSchedule = (): void => {
      const next = controller.getSnapshot().sleepTimer;
      if (next === scheduledTimer) return;
      clearSchedule();
      scheduledTimer = next;
      if (next?.kind !== "after-duration") return;
      const remaining = next.firesAt - Date.now();
      if (remaining <= 0) {
        pulse();
        return;
      }
      deadlineTimeout = window.setTimeout(pulse, remaining);
      const beginFade = (): void => {
        pulse();
        fadeInterval = window.setInterval(pulse, 100);
      };
      if (remaining <= 3_000) beginFade();
      else fadeTimeout = window.setTimeout(beginFade, remaining - 3_000);
    };
    const onWake = (): void => pulse();
    const unsubscribe = controller.subscribe(syncSchedule);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    syncSchedule();
    return () => {
      unsubscribe();
      clearSchedule();
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [controller]);

  const connectAudio = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    audioOutput.connect(node);
  }, [audioOutput]);

  useEffect(() => {
    const generation = cleanupGenerationRef.current + 1;
    cleanupGenerationRef.current = generation;

    return () => {
      subscriptionStore.destroy();
      queueMicrotask(() => {
        if (cleanupGenerationRef.current === generation) {
          controller.destroy();
        }
      });
    };
  }, [controller, subscriptionStore]);

  const dispatch = useCallback((command: PlayerCommand) => {
    const before = controller.getSnapshot();
    controller.dispatch(command);
    const after = controller.getSnapshot();
    if (hydrated && command.type === "SET_MODE" && after.mode !== before.mode) {
      setPreference?.("mode", after.mode);
    }
    if (hydrated && command.type === "SET_VOLUME" && after.volume !== before.volume) {
      setPreference?.("volume", after.volume);
    }
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (command.type === "SEEK_COMMIT" && after.durationMs !== null) {
      audio.currentTime = after.currentTimeMs / 1_000;
    }

    if (command.type === "PREVIOUS"
      && before.loadRevision === after.loadRevision
      && before.currentTimeMs !== after.currentTimeMs) {
      audio.currentTime = after.currentTimeMs / 1_000;
    }
  }, [controller, hydrated, setPreference]);

  const getPublicSnapshot = useCallback(() => {
    return subscriptionStore.getPublicSnapshot();
  }, [subscriptionStore]);

  const getTimelineSnapshot = useCallback(() => {
    return subscriptionStore.getTimelineSnapshot();
  }, [subscriptionStore]);

  const subscribe = useCallback(
    (listener: () => void) => subscriptionStore.subscribe(listener),
    [subscriptionStore],
  );

  const subscribeTimeline = useCallback(
    (listener: () => void) => subscriptionStore.subscribeTimeline(listener),
    [subscriptionStore],
  );

  const runtime = useMemo<PlayerRuntimeContextValue>(() => ({
    audioRef,
    connectAudio,
    controller,
    dispatch,
    getPublicSnapshot,
    getTimelineSnapshot,
    subscribe,
    subscribeTimeline,
  }), [
    connectAudio,
    controller,
    dispatch,
    getPublicSnapshot,
    getTimelineSnapshot,
    subscribe,
    subscribeTimeline,
  ]);

  return (
    <PlayerRuntimeContext.Provider value={runtime}>
      {children}
      <PersistentAudioHost />
      <PersistentPlayerBar />
    </PlayerRuntimeContext.Provider>
  );
}
