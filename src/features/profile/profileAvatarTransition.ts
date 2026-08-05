import { useSyncExternalStore } from "react";

export interface ProfileAvatarPresentation {
  avatarUrl: string | null;
  nickname: string;
  useFallback?: boolean;
}

export interface ProfileAvatarTransitionBounds {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface ProfileAvatarTransitionRequest {
  avatar: ProfileAvatarPresentation;
  id: number;
  source: ProfileAvatarTransitionBounds;
  userId: string;
}

interface ProfileAvatarTransitionSnapshot {
  request: ProfileAvatarTransitionRequest | null;
  target: HTMLElement | null;
}

const emptySnapshot: ProfileAvatarTransitionSnapshot = {
  request: null,
  target: null,
};

let nextTransitionId = 0;
let pendingRequest: ProfileAvatarTransitionRequest | null = null;
let snapshot = emptySnapshot;
const listeners = new Set<() => void>();
const targets = new Map<string, HTMLElement>();

function publish(): void {
  snapshot = pendingRequest
    ? { request: pendingRequest, target: targets.get(pendingRequest.userId) ?? null }
    : emptySnapshot;
  listeners.forEach((listener) => listener());
}

export function requestProfileAvatarTransition({
  avatar,
  source,
  userId,
}: Omit<ProfileAvatarTransitionRequest, "id">): void {
  nextTransitionId += 1;
  pendingRequest = {
    avatar,
    id: nextTransitionId,
    source,
    userId,
  };
  publish();
}

export function registerProfileAvatarTransitionTarget(
  userId: string,
  element: HTMLElement,
): () => void {
  targets.set(userId, element);
  publish();

  return () => {
    if (targets.get(userId) === element) {
      targets.delete(userId);
      publish();
    }
  };
}

export function completeProfileAvatarTransition(transitionId: number): void {
  if (pendingRequest?.id !== transitionId) {
    return;
  }
  pendingRequest = null;
  publish();
}

export function subscribeProfileAvatarTransition(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ProfileAvatarTransitionSnapshot {
  return snapshot;
}

export function useProfileAvatarTransitionSnapshot(): ProfileAvatarTransitionSnapshot {
  return useSyncExternalStore(
    subscribeProfileAvatarTransition,
    getSnapshot,
    () => emptySnapshot,
  );
}
