"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type RefObject,
} from "react";

import type {
  PlayerCommand,
  PlayerController,
  PlayerSnapshot,
} from "@/lib/player";

export type PlayerPublicSnapshot = Omit<
  PlayerSnapshot,
  "source" | "shuffleBag" | "playbackHistory" | "loadOrigin"
> & {
  canNext: boolean;
  canPrevious: boolean;
  hasSource: boolean;
};

export interface PlayerRuntimeContextValue {
  audioRef: RefObject<HTMLAudioElement | null>;
  connectAudio(node: HTMLAudioElement | null): void;
  controller: PlayerController;
  dispatch(command: PlayerCommand): void;
  getPublicSnapshot(): PlayerPublicSnapshot;
  subscribe(listener: () => void): () => void;
}

export const PlayerRuntimeContext = createContext<PlayerRuntimeContextValue | null>(null);

export function usePlayerRuntime(): PlayerRuntimeContextValue {
  const runtime = useContext(PlayerRuntimeContext);
  if (!runtime) {
    throw new Error("Player hooks must be used inside PlayerProvider.");
  }
  return runtime;
}

export function usePlayerDispatch(): (command: PlayerCommand) => void {
  return usePlayerRuntime().dispatch;
}

export function usePlayerSelector<T>(
  selector: (snapshot: PlayerPublicSnapshot) => T,
): T {
  const runtime = usePlayerRuntime();
  const getSelectedSnapshot = useCallback(
    () => selector(runtime.getPublicSnapshot()),
    [runtime, selector],
  );

  return useSyncExternalStore(
    runtime.subscribe,
    getSelectedSnapshot,
    getSelectedSnapshot,
  );
}
