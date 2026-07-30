import type {
  PlaybackSource,
  Track,
} from "../music/models";

export type PlaybackStatus =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export type NetworkStatus = "idle" | "buffering" | "stalled";
export type SeekStatus = "idle" | "seeking";
export type DesiredPlayback = "paused" | "playing";
export type PlaybackMode = "sequential" | "shuffle" | "repeat-one";
export type PauseReason = "user" | "sleep-timer" | "system";
export type LoadOrigin = "user" | "automatic" | "refresh" | "retry";

export type PlayerErrorCode =
  | "AUTOPLAY_BLOCKED"
  | "TRACK_UNAVAILABLE"
  | "VIP_REQUIRED"
  | "REGION_RESTRICTED"
  | "SOURCE_EXPIRED"
  | "SOURCE_UNSUPPORTED"
  | "DECODE_ERROR"
  | "MEDIA_ABORTED"
  | "NETWORK_ERROR"
  | "UPSTREAM_ERROR"
  | "QUEUE_EXHAUSTED"
  | "UNKNOWN_MEDIA_ERROR";

export interface PlayerError {
  code: PlayerErrorCode;
  message: string;
  retryable: boolean;
  fatal: boolean;
}

export interface QueueItem {
  queueItemId: string;
  track: Track;
  sourceContext: "daily" | "search" | "album" | "playlist" | "manual";
}

export type SleepTimer =
  | { kind: "after-duration"; firesAt: number }
  | { kind: "end-of-track" };

export interface PlayerSnapshot {
  playbackStatus: PlaybackStatus;
  networkStatus: NetworkStatus;
  seekStatus: SeekStatus;
  desiredPlayback: DesiredPlayback;
  currentTrack: Track | null;
  source: PlaybackSource | null;
  queue: readonly QueueItem[];
  currentIndex: number;
  mode: PlaybackMode;
  currentTimeMs: number;
  durationMs: number | null;
  bufferedUntilMs: number;
  volume: number;
  muted: boolean;
  activeLyricLine: number | null;
  error: PlayerError | null;
  sleepTimer: SleepTimer | null;
  sleepFadeGain: number;
  loadRevision: number;
  sourceRefreshCount: number;
  controlledReloadCount: number;
  loadOrigin: LoadOrigin;
  shuffleBag: readonly string[];
  playbackHistory: readonly string[];
}

export type PlayerCommand =
  | { type: "LOAD_TRACK"; track: Track; queue?: readonly QueueItem[]; autoplay: boolean }
  | { type: "PLAY" }
  | { type: "PAUSE"; reason: PauseReason }
  | { type: "TOGGLE_PLAYBACK" }
  | { type: "SEEK_START" }
  | { type: "SEEK_PREVIEW"; timeMs: number }
  | { type: "SEEK_COMMIT"; timeMs: number }
  | { type: "NEXT"; origin: "user" | "automatic" }
  | { type: "PREVIOUS" }
  | { type: "SET_QUEUE"; queue: readonly QueueItem[]; startTrackId?: string }
  | { type: "ENQUEUE"; item: QueueItem }
  | { type: "REMOVE_FROM_QUEUE"; queueItemId: string }
  | { type: "SET_MODE"; mode: PlaybackMode }
  | { type: "SET_VOLUME"; volume: number }
  | { type: "SET_MUTED"; muted: boolean }
  | { type: "SET_SLEEP_TIMER"; timer: SleepTimer | null }
  | { type: "RETRY" }
  | { type: "UNLOAD" };

export type PlayerEvent =
  | { type: "SOURCE_RESOLVED"; revision: number; source: PlaybackSource }
  | { type: "SOURCE_REJECTED"; revision: number; error: PlayerError }
  | { type: "MEDIA_LOADEDMETADATA"; revision: number; durationMs: number }
  | { type: "MEDIA_CANPLAY"; revision: number }
  | { type: "MEDIA_PLAY"; revision: number }
  | { type: "MEDIA_PAUSE"; revision: number }
  | { type: "MEDIA_TIME"; revision: number; currentTimeMs: number }
  | { type: "MEDIA_PROGRESS"; revision: number; bufferedUntilMs: number }
  | { type: "MEDIA_WAITING"; revision: number }
  | { type: "MEDIA_STALLED"; revision: number }
  | { type: "MEDIA_SEEKED"; revision: number }
  | { type: "MEDIA_ENDED"; revision: number }
  | { type: "MEDIA_ERROR"; revision: number; mediaCode: number | null }
  | { type: "PLAY_REJECTED"; revision: number; name: string }
  | { type: "SLEEP_TIMER_TICK"; now: number }
  | { type: "SLEEP_TIMER_FIRED" };

export interface PlayerReducerContext {
  random?: () => number;
}

export interface PlayerSourceResolver {
  (
    track: Track,
    context: { revision: number; cancelled: () => boolean },
  ): Promise<PlaybackSource>;
}

export interface PlayerControllerOptions {
  resolveSource: PlayerSourceResolver;
  requestPlay?: () => Promise<void>;
  requestPause?: () => void;
  now?: () => number;
  random?: () => number;
}

export interface PlayerController {
  getSnapshot(): PlayerSnapshot;
  dispatch(action: PlayerCommand | PlayerEvent): void;
  subscribe(listener: (snapshot: PlayerSnapshot) => void): () => void;
  recoverStall(): void;
  destroy(): void;
}
