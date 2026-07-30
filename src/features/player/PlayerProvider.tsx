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

import { PersistentAudioHost } from "./PersistentAudioHost";
import { PersistentPlayerBar } from "./PersistentPlayerBar";
import {
  PlayerRuntimeContext,
  type PlayerPublicSnapshot,
  type PlayerRuntimeContextValue,
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
    loadOrigin: _loadOrigin,
    playbackHistory,
    shuffleBag,
    source,
    ...publicFields
  } = snapshot;
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

export function PlayerProvider({
  children,
  sourceResolver = resolvePlaybackSource,
}: PlayerProviderProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const publicSnapshotRef = useRef<{
    internal: PlayerSnapshot | null;
    value: PlayerPublicSnapshot | null;
  }>({ internal: null, value: null });
  const cleanupGenerationRef = useRef(0);
  const [audioOutput] = useState(() => new AudioOutputBridge());

  const [controller] = useState(() => createPlayerController({
    resolveSource: sourceResolver,
    requestPause: () => audioOutput.pause(),
    requestPlay: () => audioOutput.play(),
  }));

  const connectAudio = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    audioOutput.connect(node);
  }, [audioOutput]);

  useEffect(() => {
    const generation = cleanupGenerationRef.current + 1;
    cleanupGenerationRef.current = generation;

    return () => {
      queueMicrotask(() => {
        if (cleanupGenerationRef.current === generation) {
          controller.destroy();
        }
      });
    };
  }, [controller]);

  const dispatch = useCallback((command: PlayerCommand) => {
    const before = controller.getSnapshot();
    controller.dispatch(command);
    const after = controller.getSnapshot();
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
  }, [controller]);

  const getPublicSnapshot = useCallback(() => {
    const internal = controller.getSnapshot();
    const cached = publicSnapshotRef.current;
    if (cached.internal === internal && cached.value) {
      return cached.value;
    }

    const value = toPublicSnapshot(internal);
    publicSnapshotRef.current = { internal, value };
    return value;
  }, [controller]);

  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  );

  const runtime = useMemo<PlayerRuntimeContextValue>(() => ({
    audioRef,
    connectAudio,
    controller,
    dispatch,
    getPublicSnapshot,
    subscribe,
  }), [connectAudio, controller, dispatch, getPublicSnapshot, subscribe]);

  return (
    <PlayerRuntimeContext.Provider value={runtime}>
      {children}
      <PersistentAudioHost />
      <PersistentPlayerBar />
    </PlayerRuntimeContext.Provider>
  );
}
