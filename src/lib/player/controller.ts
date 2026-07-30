import type { AppErrorCode } from "../music/errors";
import {
  assertPlayerSnapshot,
  beginTrackLoad,
  createInitialPlayerSnapshot,
  isSourceNearExpiry,
  playerError,
  reducePlayerSnapshot,
} from "./reducer";
import { currentQueueItemId } from "./queue";
import type {
  PlayerCommand,
  PlayerController,
  PlayerControllerOptions,
  PlayerError,
  PlayerEvent,
  PlayerSnapshot,
} from "./types";

interface CancellationRecord {
  cancelled: boolean;
}

const playerErrorCodes = new Set<PlayerError["code"]>([
  "AUTOPLAY_BLOCKED",
  "TRACK_UNAVAILABLE",
  "VIP_REQUIRED",
  "REGION_RESTRICTED",
  "SOURCE_EXPIRED",
  "SOURCE_UNSUPPORTED",
  "DECODE_ERROR",
  "MEDIA_ABORTED",
  "NETWORK_ERROR",
  "UPSTREAM_ERROR",
  "QUEUE_EXHAUSTED",
  "UNKNOWN_MEDIA_ERROR",
]);

const appErrorMapping: Partial<Record<AppErrorCode, PlayerError["code"]>> = {
  TRACK_UNAVAILABLE: "TRACK_UNAVAILABLE",
  VIP_REQUIRED: "VIP_REQUIRED",
  REGION_RESTRICTED: "REGION_RESTRICTED",
  SOURCE_EXPIRED: "SOURCE_EXPIRED",
  NETWORK_ERROR: "NETWORK_ERROR",
  UPSTREAM_TIMEOUT: "UPSTREAM_ERROR",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_ERROR",
};

function isPlayerEvent(action: PlayerCommand | PlayerEvent): action is PlayerEvent {
  return action.type.startsWith("MEDIA_")
    || action.type.startsWith("SOURCE_")
    || action.type === "PLAY_REJECTED"
    || action.type.startsWith("SLEEP_TIMER_");
}

function normalizeSourceError(error: unknown): PlayerError {
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      retryable?: unknown;
      fatal?: unknown;
    };
    const code = typeof candidate.code === "string"
      ? candidate.code
      : null;

    if (code && playerErrorCodes.has(code as PlayerError["code"])) {
      return playerError(
        code as PlayerError["code"],
        typeof candidate.message === "string"
          ? candidate.message
          : "当前歌曲无法播放。",
        {
          retryable: candidate.retryable === true,
          fatal: candidate.fatal !== false,
        },
      );
    }

    const mappedCode = code ? appErrorMapping[code as AppErrorCode] : undefined;
    if (mappedCode) {
      return playerError(
        mappedCode,
        typeof candidate.message === "string"
          ? candidate.message
          : "当前歌曲无法播放。",
        { retryable: candidate.retryable === true },
      );
    }
  }

  return playerError("UPSTREAM_ERROR", "播放源请求失败。", { retryable: true });
}

export function getStalledRecoveryPlan(
  snapshot: PlayerSnapshot,
  now: number,
): "refresh-source" | "reload-source" | "fail" {
  if (!snapshot.currentTrack || !snapshot.source) {
    return "fail";
  }
  if (isSourceNearExpiry(snapshot.source, now) && snapshot.sourceRefreshCount < 1) {
    return "refresh-source";
  }
  if (snapshot.controlledReloadCount < 1) {
    return "reload-source";
  }
  return "fail";
}

export function createPlayerController(
  options: PlayerControllerOptions,
): PlayerController {
  let snapshot = createInitialPlayerSnapshot();
  let activeResolution: CancellationRecord | null = null;
  let destroyed = false;
  let playRequestRevision: number | null = null;
  let playIntentRevision = 0;
  const automaticSkipVisited = new Set<string>();
  const listeners = new Set<(next: PlayerSnapshot) => void>();
  const now = options.now ?? Date.now;

  const publish = (next: PlayerSnapshot): void => {
    if (next === snapshot) {
      return;
    }
    assertPlayerSnapshot(next);
    snapshot = next;
    listeners.forEach((listener) => listener(snapshot));
  };

  const reduce = (action: PlayerCommand | PlayerEvent): void => {
    publish(reducePlayerSnapshot(snapshot, action, { random: options.random }));
  };

  const cancelResolution = (): void => {
    if (activeResolution) {
      activeResolution.cancelled = true;
      activeResolution = null;
    }
  };

  const requestPlay = (): void => {
    if (!options.requestPlay
      || !snapshot.source
      || snapshot.desiredPlayback !== "playing"
      || playRequestRevision === snapshot.loadRevision) {
      return;
    }

    const revision = snapshot.loadRevision;
    const intentRevision = playIntentRevision;
    playRequestRevision = revision;

    void options.requestPlay().then(
      () => undefined,
      (error: unknown) => {
        if (destroyed
          || revision !== snapshot.loadRevision
          || intentRevision !== playIntentRevision
          || snapshot.desiredPlayback !== "playing") {
          return;
        }
        playRequestRevision = null;
        const name = typeof error === "object" && error !== null
          && "name" in error && typeof error.name === "string"
          ? error.name
          : "UnknownError";
        reduce({ type: "PLAY_REJECTED", revision, name });
      },
    );
  };

  const startSourceResolution = (): void => {
    if (!snapshot.currentTrack || snapshot.playbackStatus !== "loading" || snapshot.source) {
      return;
    }

    cancelResolution();
    const cancellation: CancellationRecord = { cancelled: false };
    activeResolution = cancellation;
    const revision = snapshot.loadRevision;
    const track = snapshot.currentTrack;

    void options.resolveSource(track, {
      revision,
      cancelled: () => cancellation.cancelled,
    }).then(
      (source) => {
        if (destroyed || cancellation.cancelled) {
          return;
        }
        activeResolution = null;
        dispatchEvent({ type: "SOURCE_RESOLVED", revision, source });
      },
      (error: unknown) => {
        if (destroyed || cancellation.cancelled) {
          return;
        }
        activeResolution = null;
        dispatchEvent({
          type: "SOURCE_REJECTED",
          revision,
          error: normalizeSourceError(error),
        });
      },
    );
  };

  const beginRefresh = (): void => {
    if (!snapshot.currentTrack || snapshot.sourceRefreshCount >= 1) {
      reduce({
        type: "SOURCE_REJECTED",
        revision: snapshot.loadRevision,
        error: playerError("SOURCE_EXPIRED", "播放源已过期。", { retryable: true }),
      });
      return;
    }

    publish(beginTrackLoad(snapshot, snapshot.currentTrack, {
      currentIndex: snapshot.currentIndex,
      autoplay: snapshot.desiredPlayback === "playing",
      origin: "refresh",
      preserveTimeMs: snapshot.currentTimeMs,
      refresh: true,
    }));
    startSourceResolution();
  };

  const beginControlledReload = (): void => {
    if (!snapshot.currentTrack || !snapshot.source) {
      return;
    }

    cancelResolution();
    playRequestRevision = null;
    publish({
      ...snapshot,
      playbackStatus: "loading",
      networkStatus: "idle",
      seekStatus: "idle",
      error: null,
      loadRevision: snapshot.loadRevision + 1,
      controlledReloadCount: snapshot.controlledReloadCount + 1,
      loadOrigin: "retry",
    });
  };

  const failQueue = (): void => {
    reduce({
      type: "SOURCE_REJECTED",
      revision: snapshot.loadRevision,
      error: playerError(
        "QUEUE_EXHAUSTED",
        "队列中没有可播放的歌曲。",
        { retryable: false },
      ),
    });
    automaticSkipVisited.clear();
  };

  const handleAutomaticSourceFailure = (): void => {
    const currentId = currentQueueItemId(snapshot.queue, snapshot.currentIndex);
    if (currentId) {
      automaticSkipVisited.add(currentId);
    }

    if (snapshot.queue.length === 0
      || automaticSkipVisited.size >= snapshot.queue.length) {
      failQueue();
      return;
    }

    const previousRevision = snapshot.loadRevision;
    reduce({ type: "NEXT", origin: "automatic" });
    if (snapshot.playbackStatus === "ended" || snapshot.loadRevision === previousRevision) {
      automaticSkipVisited.clear();
      return;
    }
    startSourceResolution();
  };

  const dispatchEvent = (event: PlayerEvent): void => {
    if ("revision" in event && event.revision !== snapshot.loadRevision) {
      return;
    }

    if (event.type === "MEDIA_PLAY"
      || event.type === "MEDIA_PAUSE"
      || event.type === "MEDIA_ENDED"
      || event.type === "MEDIA_ERROR"
      || event.type === "PLAY_REJECTED") {
      playRequestRevision = null;
    }

    if (event.type === "SOURCE_REJECTED" && snapshot.loadOrigin === "automatic") {
      handleAutomaticSourceFailure();
      return;
    }

    if (event.type === "MEDIA_ERROR") {
      if ((event.mediaCode === 4 || event.mediaCode === null)
        && snapshot.sourceRefreshCount < 1) {
        beginRefresh();
        return;
      }
      if (event.mediaCode === 2) {
        const plan = getStalledRecoveryPlan(snapshot, now());
        if (plan === "refresh-source") {
          beginRefresh();
          return;
        }
        if (plan === "reload-source") {
          beginControlledReload();
          return;
        }
      }
    }

    if (event.type === "MEDIA_ENDED" && snapshot.mode !== "repeat-one") {
      const currentId = currentQueueItemId(snapshot.queue, snapshot.currentIndex);
      if (currentId) {
        automaticSkipVisited.add(currentId);
      }
    }

    const previousRevision = snapshot.loadRevision;
    reduce(event);

    if (event.type === "SOURCE_RESOLVED" && snapshot.loadOrigin === "automatic") {
      automaticSkipVisited.clear();
    }

    if (event.type === "MEDIA_LOADEDMETADATA" || event.type === "MEDIA_CANPLAY") {
      if (snapshot.desiredPlayback === "playing") {
        requestPlay();
      }
    }

    if (event.type === "MEDIA_ENDED") {
      if (snapshot.loadRevision !== previousRevision) {
        startSourceResolution();
      } else if (snapshot.mode === "repeat-one"
        && snapshot.desiredPlayback === "playing") {
        requestPlay();
      }
    }

    if (event.type === "SLEEP_TIMER_FIRED") {
      playIntentRevision += 1;
      playRequestRevision = null;
      options.requestPause?.();
    }
  };

  const dispatchCommand = (command: PlayerCommand): void => {
    if (command.type === "TOGGLE_PLAYBACK") {
      dispatchCommand(snapshot.desiredPlayback === "playing"
        ? { type: "PAUSE", reason: "user" }
        : { type: "PLAY" });
      return;
    }

    if (command.type === "PLAY") {
      reduce(command);
      if (snapshot.source && isSourceNearExpiry(snapshot.source, now())) {
        beginRefresh();
        return;
      }
      requestPlay();
      return;
    }

    if (command.type === "PAUSE") {
      playIntentRevision += 1;
      playRequestRevision = null;
      reduce(command);
      options.requestPause?.();
      return;
    }

    if (command.type === "UNLOAD") {
      cancelResolution();
      playIntentRevision += 1;
      playRequestRevision = null;
      automaticSkipVisited.clear();
      reduce(command);
      options.requestPause?.();
      return;
    }

    if (command.type === "NEXT" && command.origin === "automatic") {
      const currentId = currentQueueItemId(snapshot.queue, snapshot.currentIndex);
      if (currentId) {
        automaticSkipVisited.add(currentId);
      }
    }

    const previousRevision = snapshot.loadRevision;
    reduce(command);

    if (snapshot.loadRevision !== previousRevision) {
      cancelResolution();
      playRequestRevision = null;
      if (command.type !== "NEXT" || command.origin !== "automatic") {
        automaticSkipVisited.clear();
      }
      startSourceResolution();
    }
  };

  const dispatch = (action: PlayerCommand | PlayerEvent): void => {
    if (destroyed) {
      return;
    }
    if (isPlayerEvent(action)) {
      dispatchEvent(action);
    } else {
      dispatchCommand(action);
    }
  };

  return {
    getSnapshot: () => snapshot,
    dispatch,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    recoverStall() {
      if (destroyed || snapshot.networkStatus !== "stalled") {
        return;
      }
      const plan = getStalledRecoveryPlan(snapshot, now());
      if (plan === "refresh-source") {
        beginRefresh();
      } else if (plan === "reload-source") {
        beginControlledReload();
      } else {
        reduce({
          type: "SOURCE_REJECTED",
          revision: snapshot.loadRevision,
          error: playerError("NETWORK_ERROR", "网络恢复失败。", { retryable: true }),
        });
      }
    },
    destroy() {
      destroyed = true;
      cancelResolution();
      listeners.clear();
      playRequestRevision = null;
      automaticSkipVisited.clear();
    },
  };
}
