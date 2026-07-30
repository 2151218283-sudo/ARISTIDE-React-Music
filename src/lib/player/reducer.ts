import type { PlaybackSource, Track } from "../music/models";
import {
  clamp,
  createShuffleBag,
  currentQueueItemId,
  findQueueIndex,
  removeQueueItemReferences,
} from "./queue";
import type {
  LoadOrigin,
  PlayerCommand,
  PlayerError,
  PlayerEvent,
  PlayerReducerContext,
  PlayerSnapshot,
  QueueItem,
} from "./types";

const defaultRandom = (): number => {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi) {
    return 0.5;
  }

  const value = new Uint32Array(1);
  cryptoApi.getRandomValues(value);
  return value[0] / 0x1_0000_0000;
};

export function createInitialPlayerSnapshot(): PlayerSnapshot {
  return {
    playbackStatus: "idle",
    networkStatus: "idle",
    seekStatus: "idle",
    desiredPlayback: "paused",
    currentTrack: null,
    source: null,
    queue: [],
    currentIndex: -1,
    mode: "sequential",
    currentTimeMs: 0,
    durationMs: null,
    bufferedUntilMs: 0,
    volume: 1,
    muted: false,
    activeLyricLine: null,
    error: null,
    sleepTimer: null,
    sleepFadeGain: 1,
    loadRevision: 0,
    sourceRefreshCount: 0,
    controlledReloadCount: 0,
    loadOrigin: "user",
    shuffleBag: [],
    playbackHistory: [],
  };
}

interface BeginTrackLoadOptions {
  queue?: readonly QueueItem[];
  currentIndex?: number;
  autoplay: boolean;
  origin: LoadOrigin;
  preserveTimeMs?: number;
  refresh?: boolean;
  controlledReload?: boolean;
}

export function beginTrackLoad(
  snapshot: PlayerSnapshot,
  track: Track,
  options: BeginTrackLoadOptions,
): PlayerSnapshot {
  const queue = options.queue ?? snapshot.queue;
  const currentIndex = options.currentIndex
    ?? queue.findIndex((item) => item.track.id === track.id);

  return {
    ...snapshot,
    playbackStatus: "loading",
    networkStatus: "idle",
    seekStatus: "idle",
    desiredPlayback: options.autoplay ? "playing" : "paused",
    currentTrack: track,
    source: null,
    queue,
    currentIndex,
    currentTimeMs: options.preserveTimeMs ?? 0,
    durationMs: null,
    bufferedUntilMs: 0,
    activeLyricLine: null,
    error: null,
    loadRevision: snapshot.loadRevision + 1,
    sourceRefreshCount: options.refresh
      ? snapshot.sourceRefreshCount + 1
      : 0,
    controlledReloadCount: options.controlledReload
      ? snapshot.controlledReloadCount + 1
      : 0,
    loadOrigin: options.origin,
  };
}

export function playerError(
  code: PlayerError["code"],
  message: string,
  options: { retryable?: boolean; fatal?: boolean } = {},
): PlayerError {
  return {
    code,
    message,
    retryable: options.retryable ?? false,
    fatal: options.fatal ?? true,
  };
}

export function mapMediaError(mediaCode: number | null): PlayerError {
  switch (mediaCode) {
    case 1:
      return playerError("MEDIA_ABORTED", "播放已被中断。", { retryable: true });
    case 2:
      return playerError("NETWORK_ERROR", "音频网络连接失败。", { retryable: true });
    case 3:
      return playerError("DECODE_ERROR", "浏览器无法解码这首歌曲。", { retryable: false });
    case 4:
      return playerError("SOURCE_UNSUPPORTED", "当前音频格式不可播放。", { retryable: true });
    default:
      return playerError("UNKNOWN_MEDIA_ERROR", "播放器遇到未知错误。", { retryable: true });
  }
}

function staleRevision(snapshot: PlayerSnapshot, revision: number): boolean {
  return revision !== snapshot.loadRevision;
}

function enterError(snapshot: PlayerSnapshot, error: PlayerError): PlayerSnapshot {
  return {
    ...snapshot,
    playbackStatus: "error",
    networkStatus: "idle",
    seekStatus: "idle",
    desiredPlayback: "paused",
    error: { ...error, fatal: true },
  };
}

function enterEnded(snapshot: PlayerSnapshot): PlayerSnapshot {
  return {
    ...snapshot,
    playbackStatus: "ended",
    networkStatus: "idle",
    seekStatus: "idle",
    desiredPlayback: "paused",
    currentTimeMs: snapshot.durationMs ?? snapshot.currentTimeMs,
    error: null,
  };
}

function loadQueueIndex(
  snapshot: PlayerSnapshot,
  index: number,
  origin: LoadOrigin,
  autoplay: boolean,
  overrides: Partial<Pick<PlayerSnapshot, "shuffleBag" | "playbackHistory">> = {},
): PlayerSnapshot {
  const item = snapshot.queue[index];
  if (!item) {
    return enterEnded(snapshot);
  }

  return beginTrackLoad(
    { ...snapshot, ...overrides },
    item.track,
    { currentIndex: index, autoplay, origin },
  );
}

function moveNext(
  snapshot: PlayerSnapshot,
  origin: "user" | "automatic",
): PlayerSnapshot {
  const autoplay = origin === "automatic"
    || snapshot.desiredPlayback === "playing"
    || snapshot.playbackStatus === "playing";

  if (snapshot.mode !== "shuffle") {
    return loadQueueIndex(snapshot, snapshot.currentIndex + 1, origin, autoplay);
  }

  const [nextId, ...remainingBag] = snapshot.shuffleBag;
  if (!nextId) {
    return enterEnded(snapshot);
  }

  const nextIndex = findQueueIndex(snapshot.queue, nextId);
  if (nextIndex < 0) {
    return {
      ...snapshot,
      shuffleBag: remainingBag,
    };
  }

  const currentId = currentQueueItemId(snapshot.queue, snapshot.currentIndex);
  const history = currentId
    ? [...snapshot.playbackHistory, currentId]
    : [...snapshot.playbackHistory];

  return loadQueueIndex(snapshot, nextIndex, origin, autoplay, {
    shuffleBag: remainingBag,
    playbackHistory: history,
  });
}

function movePrevious(snapshot: PlayerSnapshot): PlayerSnapshot {
  if (snapshot.currentTimeMs > 3_000) {
    return { ...snapshot, currentTimeMs: 0 };
  }

  const autoplay = snapshot.desiredPlayback === "playing"
    || snapshot.playbackStatus === "playing";

  if (snapshot.mode !== "shuffle") {
    if (snapshot.currentIndex <= 0) {
      return { ...snapshot, currentTimeMs: 0 };
    }

    return loadQueueIndex(snapshot, snapshot.currentIndex - 1, "user", autoplay);
  }

  const history = [...snapshot.playbackHistory];
  const previousId = history.pop();
  if (!previousId) {
    return { ...snapshot, currentTimeMs: 0 };
  }

  const previousIndex = findQueueIndex(snapshot.queue, previousId);
  if (previousIndex < 0) {
    return { ...snapshot, playbackHistory: history };
  }

  const currentId = currentQueueItemId(snapshot.queue, snapshot.currentIndex);
  const shuffleBag = currentId
    ? [currentId, ...snapshot.shuffleBag]
    : [...snapshot.shuffleBag];

  return loadQueueIndex(snapshot, previousIndex, "user", autoplay, {
    playbackHistory: history,
    shuffleBag,
  });
}

function setQueue(
  snapshot: PlayerSnapshot,
  queue: readonly QueueItem[],
  startTrackId: string | undefined,
  random: () => number,
): PlayerSnapshot {
  if (queue.length === 0) {
    const initial = createInitialPlayerSnapshot();
    return {
      ...initial,
      volume: snapshot.volume,
      muted: snapshot.muted,
      mode: snapshot.mode,
      loadRevision: snapshot.loadRevision + 1,
    };
  }

  const oldCurrentId = currentQueueItemId(snapshot.queue, snapshot.currentIndex);
  const preservedIndex = findQueueIndex(queue, oldCurrentId);
  if (preservedIndex >= 0 && snapshot.currentTrack) {
    const currentId = queue[preservedIndex].queueItemId;
    const validIds = new Set(queue.map((item) => item.queueItemId));
    const playbackHistory = snapshot.playbackHistory.filter((id) => validIds.has(id));
    const remainingBag = snapshot.shuffleBag.filter((id) => validIds.has(id));
    const alreadyScheduled = new Set([
      currentId,
      ...playbackHistory,
      ...remainingBag,
    ]);
    const additions = queue.filter((item) => !alreadyScheduled.has(item.queueItemId));
    const shuffledAdditions = createShuffleBag(additions, null, random);
    return {
      ...snapshot,
      queue,
      currentIndex: preservedIndex,
      shuffleBag: snapshot.mode === "shuffle"
        ? [...remainingBag, ...shuffledAdditions]
        : [],
      playbackHistory,
    };
  }

  const requestedIndex = startTrackId
    ? queue.findIndex((item) => item.track.id === startTrackId)
    : 0;
  const index = requestedIndex >= 0 ? requestedIndex : 0;
  const next = beginTrackLoad(snapshot, queue[index].track, {
    queue,
    currentIndex: index,
    autoplay: snapshot.desiredPlayback === "playing",
    origin: "user",
  });

  return {
    ...next,
    shuffleBag: snapshot.mode === "shuffle"
      ? createShuffleBag(queue, queue[index].queueItemId, random)
      : [],
    playbackHistory: [],
  };
}

function removeFromQueue(snapshot: PlayerSnapshot, queueItemId: string): PlayerSnapshot {
  const removedIndex = findQueueIndex(snapshot.queue, queueItemId);
  if (removedIndex < 0) {
    return snapshot;
  }

  const currentId = currentQueueItemId(snapshot.queue, snapshot.currentIndex);
  const queue = snapshot.queue.filter((item) => item.queueItemId !== queueItemId);
  const references = {
    shuffleBag: removeQueueItemReferences(snapshot.shuffleBag, queueItemId),
    playbackHistory: removeQueueItemReferences(snapshot.playbackHistory, queueItemId),
  };

  if (queue.length === 0) {
    const initial = createInitialPlayerSnapshot();
    return {
      ...initial,
      volume: snapshot.volume,
      muted: snapshot.muted,
      mode: snapshot.mode,
      loadRevision: snapshot.loadRevision + 1,
    };
  }

  if (currentId !== queueItemId) {
    const currentIndex = findQueueIndex(queue, currentId);
    return { ...snapshot, queue, currentIndex, ...references };
  }

  if (removedIndex >= queue.length) {
    return {
      ...enterEnded(snapshot),
      queue,
      currentIndex: -1,
      ...references,
    };
  }

  return beginTrackLoad(
    { ...snapshot, queue, ...references },
    queue[removedIndex].track,
    {
      queue,
      currentIndex: removedIndex,
      autoplay: snapshot.desiredPlayback === "playing",
      origin: "automatic",
    },
  );
}

function handleEnded(snapshot: PlayerSnapshot): PlayerSnapshot {
  if (snapshot.sleepTimer?.kind === "end-of-track") {
    return {
      ...snapshot,
      playbackStatus: "paused",
      networkStatus: "idle",
      desiredPlayback: "paused",
      currentTimeMs: snapshot.durationMs ?? snapshot.currentTimeMs,
      sleepTimer: null,
      sleepFadeGain: 1,
    };
  }

  if (snapshot.mode === "repeat-one") {
    return {
      ...snapshot,
      playbackStatus: "ready",
      networkStatus: "idle",
      desiredPlayback: "playing",
      currentTimeMs: 0,
      error: null,
    };
  }

  return moveNext(snapshot, "automatic");
}

function sleepFadeGain(snapshot: PlayerSnapshot, now: number): number {
  if (!snapshot.sleepTimer) {
    return 1;
  }

  if (snapshot.sleepTimer.kind === "after-duration") {
    return clamp((snapshot.sleepTimer.firesAt - now) / 3_000, 0, 1);
  }

  if (snapshot.durationMs === null) {
    return 1;
  }

  return clamp((snapshot.durationMs - snapshot.currentTimeMs) / 3_000, 0, 1);
}

function reduceCommand(
  snapshot: PlayerSnapshot,
  command: PlayerCommand,
  context: PlayerReducerContext,
): PlayerSnapshot {
  const random = context.random ?? defaultRandom;

  switch (command.type) {
    case "LOAD_TRACK": {
      const queue = command.queue ?? snapshot.queue;
      const currentIndex = queue.findIndex((item) => item.track.id === command.track.id);
      const next = beginTrackLoad(snapshot, command.track, {
        queue,
        currentIndex,
        autoplay: command.autoplay,
        origin: "user",
      });
      return {
        ...next,
        shuffleBag: snapshot.mode === "shuffle"
          ? createShuffleBag(queue, currentQueueItemId(queue, currentIndex), random)
          : [],
        playbackHistory: [],
      };
    }
    case "PLAY":
      if (!snapshot.currentTrack || snapshot.playbackStatus === "idle") {
        return snapshot;
      }
      return {
        ...snapshot,
        desiredPlayback: "playing",
        error: snapshot.error?.code === "AUTOPLAY_BLOCKED" ? null : snapshot.error,
      };
    case "PAUSE":
      return {
        ...snapshot,
        desiredPlayback: "paused",
        playbackStatus: snapshot.playbackStatus === "playing"
          || snapshot.playbackStatus === "ready"
          ? "paused"
          : snapshot.playbackStatus,
        networkStatus: "idle",
      };
    case "TOGGLE_PLAYBACK":
      return reduceCommand(snapshot, {
        type: snapshot.desiredPlayback === "playing" ? "PAUSE" : "PLAY",
        ...(snapshot.desiredPlayback === "playing" ? { reason: "user" as const } : {}),
      } as PlayerCommand, context);
    case "SEEK_START":
      return snapshot.currentTrack
        ? { ...snapshot, seekStatus: "seeking" }
        : snapshot;
    case "SEEK_PREVIEW":
      if (snapshot.seekStatus !== "seeking" || snapshot.durationMs === null) {
        return snapshot;
      }
      return {
        ...snapshot,
        currentTimeMs: clamp(command.timeMs, 0, snapshot.durationMs),
      };
    case "SEEK_COMMIT":
      if (!snapshot.currentTrack || snapshot.durationMs === null) {
        return snapshot;
      }
      return {
        ...snapshot,
        seekStatus: "seeking",
        currentTimeMs: clamp(command.timeMs, 0, snapshot.durationMs),
      };
    case "NEXT":
      return moveNext(snapshot, command.origin);
    case "PREVIOUS":
      return movePrevious(snapshot);
    case "SET_QUEUE":
      return setQueue(snapshot, command.queue, command.startTrackId, random);
    case "ENQUEUE":
      if (snapshot.queue.some((item) => item.queueItemId === command.item.queueItemId)) {
        return snapshot;
      }
      return {
        ...snapshot,
        queue: [...snapshot.queue, command.item],
        shuffleBag: snapshot.mode === "shuffle"
          ? [...snapshot.shuffleBag, command.item.queueItemId]
          : snapshot.shuffleBag,
      };
    case "REMOVE_FROM_QUEUE":
      return removeFromQueue(snapshot, command.queueItemId);
    case "SET_MODE": {
      const currentId = currentQueueItemId(snapshot.queue, snapshot.currentIndex);
      return {
        ...snapshot,
        mode: command.mode,
        shuffleBag: command.mode === "shuffle"
          ? createShuffleBag(snapshot.queue, currentId, random)
          : [],
        playbackHistory: command.mode === "shuffle" ? [] : snapshot.playbackHistory,
      };
    }
    case "SET_VOLUME":
      return { ...snapshot, volume: clamp(command.volume, 0, 1) };
    case "SET_MUTED":
      return { ...snapshot, muted: command.muted };
    case "SET_SLEEP_TIMER":
      return { ...snapshot, sleepTimer: command.timer, sleepFadeGain: 1 };
    case "RETRY":
      return snapshot.currentTrack
        ? beginTrackLoad(snapshot, snapshot.currentTrack, {
          currentIndex: snapshot.currentIndex,
          autoplay: snapshot.desiredPlayback === "playing",
          origin: "retry",
        })
        : snapshot;
    case "UNLOAD": {
      const initial = createInitialPlayerSnapshot();
      return {
        ...initial,
        volume: snapshot.volume,
        muted: snapshot.muted,
        mode: snapshot.mode,
        loadRevision: snapshot.loadRevision + 1,
      };
    }
  }
}

function reduceEvent(snapshot: PlayerSnapshot, event: PlayerEvent): PlayerSnapshot {
  if ("revision" in event && staleRevision(snapshot, event.revision)) {
    return snapshot;
  }

  switch (event.type) {
    case "SOURCE_RESOLVED":
      return snapshot.playbackStatus === "loading"
        ? { ...snapshot, source: event.source, error: null }
        : snapshot;
    case "SOURCE_REJECTED":
      return enterError(snapshot, event.error);
    case "MEDIA_LOADEDMETADATA":
      return snapshot.currentTrack && snapshot.source
        ? {
          ...snapshot,
          playbackStatus: "ready",
          durationMs: Math.max(0, event.durationMs),
          currentTimeMs: clamp(snapshot.currentTimeMs, 0, Math.max(0, event.durationMs)),
        }
        : snapshot;
    case "MEDIA_CANPLAY":
      return { ...snapshot, networkStatus: "idle" };
    case "MEDIA_PLAY":
      return snapshot.currentTrack && snapshot.source
        && snapshot.desiredPlayback === "playing"
        ? {
          ...snapshot,
          playbackStatus: "playing",
          networkStatus: "idle",
          error: null,
        }
        : snapshot;
    case "MEDIA_PAUSE":
      if (snapshot.playbackStatus === "ended" || snapshot.playbackStatus === "loading") {
        return snapshot;
      }
      return {
        ...snapshot,
        playbackStatus: snapshot.currentTrack ? "paused" : "idle",
        desiredPlayback: "paused",
        networkStatus: "idle",
      };
    case "MEDIA_TIME": {
      const maximum = snapshot.durationMs ?? Number.MAX_SAFE_INTEGER;
      return {
        ...snapshot,
        currentTimeMs: clamp(event.currentTimeMs, 0, maximum),
        networkStatus: snapshot.desiredPlayback === "playing"
          ? "idle"
          : snapshot.networkStatus,
      };
    }
    case "MEDIA_PROGRESS":
      return {
        ...snapshot,
        bufferedUntilMs: Math.max(0, event.bufferedUntilMs),
      };
    case "MEDIA_WAITING":
      return snapshot.desiredPlayback === "playing"
        ? { ...snapshot, networkStatus: "buffering" }
        : snapshot;
    case "MEDIA_STALLED":
      return snapshot.desiredPlayback === "playing"
        ? { ...snapshot, networkStatus: "stalled" }
        : snapshot;
    case "MEDIA_SEEKED":
      return { ...snapshot, seekStatus: "idle" };
    case "MEDIA_ENDED":
      return handleEnded(snapshot);
    case "MEDIA_ERROR":
      return enterError(snapshot, mapMediaError(event.mediaCode));
    case "PLAY_REJECTED":
      if (event.name === "NotAllowedError") {
        return {
          ...snapshot,
          playbackStatus: "paused",
          desiredPlayback: "paused",
          networkStatus: "idle",
          error: playerError(
            "AUTOPLAY_BLOCKED",
            "浏览器已阻止自动播放，请手动开始播放。",
            { retryable: true, fatal: false },
          ),
        };
      }
      return enterError(
        snapshot,
        playerError("UNKNOWN_MEDIA_ERROR", "音频未能开始播放。", { retryable: true }),
      );
    case "SLEEP_TIMER_TICK":
      return { ...snapshot, sleepFadeGain: sleepFadeGain(snapshot, event.now) };
    case "SLEEP_TIMER_FIRED":
      return {
        ...snapshot,
        playbackStatus: snapshot.currentTrack ? "paused" : "idle",
        desiredPlayback: "paused",
        sleepTimer: null,
        sleepFadeGain: 1,
        networkStatus: "idle",
      };
  }
}

export function reducePlayerSnapshot(
  snapshot: PlayerSnapshot,
  action: PlayerCommand | PlayerEvent,
  context: PlayerReducerContext = {},
): PlayerSnapshot {
  return action.type.startsWith("MEDIA_")
    || action.type.startsWith("SOURCE_")
    || action.type === "PLAY_REJECTED"
    || action.type.startsWith("SLEEP_TIMER_")
    ? reduceEvent(snapshot, action as PlayerEvent)
    : reduceCommand(snapshot, action as PlayerCommand, context);
}

export function isSourceNearExpiry(
  source: PlaybackSource,
  now: number,
): boolean {
  return now >= source.expiresAt - 60_000;
}

export function validatePlayerSnapshot(snapshot: PlayerSnapshot): string[] {
  const violations: string[] = [];

  if (!snapshot.currentTrack && snapshot.playbackStatus !== "idle") {
    violations.push("A player without a current track must be idle.");
  }
  if (!snapshot.currentTrack && (snapshot.source || snapshot.currentIndex !== -1)) {
    violations.push("An idle player must not retain source or queue index state.");
  }
  if (snapshot.playbackStatus === "playing"
    && (!snapshot.currentTrack || !snapshot.source || snapshot.desiredPlayback !== "playing")) {
    violations.push("Playing requires a track, source, and playing intent.");
  }
  if (snapshot.playbackStatus === "error" && !snapshot.error) {
    violations.push("The error lifecycle requires a structured error.");
  }

  return violations;
}

export function assertPlayerSnapshot(snapshot: PlayerSnapshot): void {
  const violations = validatePlayerSnapshot(snapshot);
  if (violations.length > 0) {
    throw new Error(violations.join(" "));
  }
}
