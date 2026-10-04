export interface DemoLibraryState {
  likedTrackIds: Set<string>;
  collectedAlbumIds: Set<string>;
}

const states = new Map<string, DemoLibraryState>();

export function getDemoLibraryState(sessionId: string): DemoLibraryState {
  const existing = states.get(sessionId);
  if (existing) {
    return existing;
  }

  const state: DemoLibraryState = {
    likedTrackIds: new Set(),
    collectedAlbumIds: new Set(),
  };
  states.set(sessionId, state);
  return state;
}

export function clearDemoLibraryState(sessionId: string): void {
  states.delete(sessionId);
}

export function clearAllDemoLibraryStates(): void {
  states.clear();
}
