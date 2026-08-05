import type { Track, TrackAvailability, AudioQuality } from "./music/models";
import type { PlaybackStatus } from "./player/types";

export const historySchema = {
  databaseName: "echoform-listening-history",
  objectStoreName: "entries",
  playedAtIndexName: "playedAt",
  version: 1,
} as const;

export const listeningHistoryChangedEvent = "echoform:history-changed";

const minimumQualifiedListeningMs = 30_000;
const seekToleranceMs = 1_000;
const completionToleranceMs = 500;

interface StoredArtist {
  id: string;
  name: string;
}

interface StoredAlbum {
  artworkUrl: string | null;
  id: string;
  name: string;
}

export interface StoredTrack {
  album: StoredAlbum;
  aliases: string[];
  artists: StoredArtist[];
  artworkUrl: string | null;
  availability: TrackAvailability;
  durationMs: number;
  explicit: boolean;
  id: string;
  name: string;
  privilege: {
    fee: number | null;
    maxQuality: AudioQuality | null;
  };
}

export interface ListeningHistoryEntry {
  completed: boolean;
  playedAt: number;
  playedMs: number;
  source: "local";
  track: StoredTrack;
  trackId: string;
}

export interface ListeningHistoryCapture {
  completed: boolean;
  playedAt: number;
  playedMs: number;
  track: Track;
  trackId: string;
}

export interface HistoryPlaybackSnapshot {
  currentTimeMs: number;
  currentTrack: Track | null;
  durationMs: number | null;
  loadRevision: number;
  playbackStatus: PlaybackStatus;
}

interface RecordingSession {
  key: string;
  lastObservedAt: number;
  lastTimeMs: number;
  playedMs: number;
  recorded: boolean;
  wasPlaying: boolean;
}

export class ListeningHistoryStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListeningHistoryStorageError";
  }
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function validQuality(value: unknown): value is AudioQuality | null {
  return value === null
    || value === "standard"
    || value === "exhigh"
    || value === "lossless"
    || value === "hires";
}

function validAvailability(value: unknown): value is TrackAvailability {
  return value === "playable"
    || value === "vip"
    || value === "copyright"
    || value === "region"
    || value === "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredTrack(value: unknown): value is StoredTrack {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.name !== "string"
    || typeof value.artworkUrl !== "string" && value.artworkUrl !== null
    || typeof value.durationMs !== "number"
    || !Number.isFinite(value.durationMs)
    || typeof value.explicit !== "boolean"
    || !validAvailability(value.availability)
    || !Array.isArray(value.aliases)
    || !value.aliases.every((alias) => typeof alias === "string")
    || !Array.isArray(value.artists)
    || !value.artists.every((artist) => (
      isRecord(artist) && typeof artist.id === "string" && typeof artist.name === "string"
    ))
    || !isRecord(value.album)
    || typeof value.album.id !== "string"
    || typeof value.album.name !== "string"
    || typeof value.album.artworkUrl !== "string" && value.album.artworkUrl !== null
    || !isRecord(value.privilege)
    || value.privilege.fee !== null && typeof value.privilege.fee !== "number"
    || !validQuality(value.privilege.maxQuality)) {
    return false;
  }

  return true;
}

function isListeningHistoryEntry(value: unknown): value is ListeningHistoryEntry {
  return isRecord(value)
    && typeof value.trackId === "string"
    && isStoredTrack(value.track)
    && typeof value.playedAt === "number"
    && Number.isFinite(value.playedAt)
    && typeof value.playedMs === "number"
    && Number.isFinite(value.playedMs)
    && typeof value.completed === "boolean"
    && value.source === "local";
}

export function toStoredTrack(track: Track): StoredTrack {
  return {
    album: {
      artworkUrl: track.album.artworkUrl,
      id: track.album.id,
      name: track.album.name,
    },
    aliases: [...track.aliases],
    artists: track.artists.map((artist) => ({ id: artist.id, name: artist.name })),
    artworkUrl: track.artworkUrl,
    availability: track.availability,
    durationMs: finiteNonNegative(track.durationMs),
    explicit: track.explicit,
    id: track.id,
    name: track.name,
    privilege: {
      fee: track.privilege.fee,
      maxQuality: track.privilege.maxQuality,
    },
  };
}

export function toTrack(stored: StoredTrack): Track {
  return {
    album: { ...stored.album },
    aliases: [...stored.aliases],
    artists: stored.artists.map((artist) => ({ ...artist, avatarUrl: null })),
    artworkUrl: stored.artworkUrl,
    availability: stored.availability,
    durationMs: stored.durationMs,
    explicit: stored.explicit,
    id: stored.id,
    name: stored.name,
    privilege: { ...stored.privilege },
  };
}

export function createListeningHistoryEntry(
  capture: ListeningHistoryCapture,
): ListeningHistoryEntry {
  return {
    completed: capture.completed,
    playedAt: finiteNonNegative(capture.playedAt),
    playedMs: finiteNonNegative(capture.playedMs),
    source: "local",
    track: toStoredTrack(capture.track),
    trackId: capture.trackId,
  };
}

export function hasReachedListeningHistoryThreshold({
  durationMs,
  playedMs,
}: {
  durationMs: number | null;
  playedMs: number;
}): boolean {
  if (finiteNonNegative(playedMs) >= minimumQualifiedListeningMs) {
    return true;
  }

  return durationMs !== null
    && finiteNonNegative(durationMs) > 0
    && finiteNonNegative(playedMs) >= finiteNonNegative(durationMs) / 2;
}

export function sortListeningHistoryEntries(
  entries: readonly ListeningHistoryEntry[],
): ListeningHistoryEntry[] {
  return [...entries].sort((first, second) => (
    second.playedAt - first.playedAt || first.trackId.localeCompare(second.trackId)
  ));
}

export function upsertListeningHistoryEntries(
  entries: readonly ListeningHistoryEntry[],
  entry: ListeningHistoryEntry,
): ListeningHistoryEntry[] {
  return [...entries.filter((item) => item.trackId !== entry.trackId), entry];
}

export function createListeningHistoryRecorder(): {
  observe(snapshot: HistoryPlaybackSnapshot, observedAt: number): ListeningHistoryCapture | null;
  reset(): void;
} {
  let session: RecordingSession | null = null;

  return {
    observe(snapshot, observedAt) {
      const track = snapshot.currentTrack;
      if (!track) {
        session = null;
        return null;
      }

      const key = `${snapshot.loadRevision}:${track.id}`;
      const timeMs = finiteNonNegative(snapshot.currentTimeMs);
      const now = finiteNonNegative(observedAt);
      if (!session || session.key !== key) {
        session = {
          key,
          lastObservedAt: now,
          lastTimeMs: timeMs,
          playedMs: 0,
          recorded: false,
          wasPlaying: snapshot.playbackStatus === "playing",
        };
        return null;
      }

      if (session.wasPlaying && snapshot.playbackStatus === "playing") {
        const mediaDelta = Math.max(0, timeMs - session.lastTimeMs);
        const elapsedMs = Math.max(0, now - session.lastObservedAt);
        session.playedMs += Math.min(mediaDelta, elapsedMs + seekToleranceMs);
      }

      session.lastObservedAt = now;
      session.lastTimeMs = timeMs;
      session.wasPlaying = snapshot.playbackStatus === "playing";

      const durationMs = snapshot.durationMs ?? (track.durationMs > 0 ? track.durationMs : null);
      if (session.recorded || !hasReachedListeningHistoryThreshold({
        durationMs,
        playedMs: session.playedMs,
      })) {
        return null;
      }

      session.recorded = true;
      return {
        completed: durationMs !== null && timeMs >= Math.max(0, durationMs - completionToleranceMs),
        playedAt: now,
        playedMs: Math.round(session.playedMs),
        track,
        trackId: track.id,
      };
    },
    reset() {
      session = null;
    },
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new ListeningHistoryStorageError(
      "无法读取本地播放记录。",
    ));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new ListeningHistoryStorageError(
      "本地播放记录操作已中止。",
    ));
    transaction.onerror = () => reject(transaction.error ?? new ListeningHistoryStorageError(
      "本地播放记录操作失败。",
    ));
  });
}

function getIndexedDbFactory(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new ListeningHistoryStorageError("当前浏览器不支持本地播放记录存储。");
  }
  return indexedDB;
}

async function openListeningHistoryDatabase(): Promise<IDBDatabase> {
  const request = getIndexedDbFactory().open(historySchema.databaseName, historySchema.version);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(historySchema.objectStoreName)) {
      const store = database.createObjectStore(historySchema.objectStoreName, {
        keyPath: "trackId",
      });
      store.createIndex(historySchema.playedAtIndexName, "playedAt", { unique: false });
    }
  };

  try {
    return await requestResult(request);
  } catch (error) {
    throw new ListeningHistoryStorageError(error instanceof Error
      ? error.message
      : "无法打开本地播放记录。");
  }
}

export async function listListeningHistory(): Promise<ListeningHistoryEntry[]> {
  const database = await openListeningHistoryDatabase();
  try {
    const transaction = database.transaction(historySchema.objectStoreName, "readonly");
    const store = transaction.objectStore(historySchema.objectStoreName);
    const values = await requestResult(store.getAll());
    await transactionComplete(transaction);
    return sortListeningHistoryEntries(values.filter(isListeningHistoryEntry));
  } catch (error) {
    throw new ListeningHistoryStorageError(error instanceof Error
      ? error.message
      : "无法读取本地播放记录。");
  } finally {
    database.close();
  }
}

export async function clearListeningHistory(): Promise<void> {
  const database = await openListeningHistoryDatabase();
  try {
    const transaction = database.transaction(historySchema.objectStoreName, "readwrite");
    const store = transaction.objectStore(historySchema.objectStoreName);
    await requestResult(store.clear());
    await transactionComplete(transaction);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(listeningHistoryChangedEvent));
    }
  } catch (error) {
    throw new ListeningHistoryStorageError(error instanceof Error
      ? error.message
      : "无法清空本地播放记录。");
  } finally {
    database.close();
  }
}

export async function saveListeningHistoryCapture(
  capture: ListeningHistoryCapture,
): Promise<ListeningHistoryEntry> {
  const entry = createListeningHistoryEntry(capture);
  const database = await openListeningHistoryDatabase();
  try {
    const transaction = database.transaction(historySchema.objectStoreName, "readwrite");
    const store = transaction.objectStore(historySchema.objectStoreName);
    await requestResult(store.put(entry));
    await transactionComplete(transaction);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(listeningHistoryChangedEvent));
    }
    return entry;
  } catch (error) {
    throw new ListeningHistoryStorageError(error instanceof Error
      ? error.message
      : "无法保存本地播放记录。");
  } finally {
    database.close();
  }
}
