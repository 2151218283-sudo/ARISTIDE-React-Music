import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearListeningHistory,
  createListeningHistoryRecorder,
  hasReachedListeningHistoryThreshold,
  historySchema,
  ListeningHistoryStorageError,
  listeningHistoryChangedEvent,
  sortListeningHistoryEntries,
  toStoredTrack,
  upsertListeningHistoryEntries,
  type ListeningHistoryEntry,
} from "../../src/lib/listeningHistory";
import type { Track } from "../../src/lib/music/models";

interface FakeRequest<T> {
  error: DOMException | null;
  onerror: ((event: Event) => void) | null;
  onsuccess: ((event: Event) => void) | null;
  result: T;
}

interface FakeTransaction {
  error: DOMException | null;
  onabort: ((event: Event) => void) | null;
  oncomplete: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  objectStore(name: string): IDBObjectStore;
}

function createClearHistoryDatabaseHarness({ failClear = false } = {}) {
  const clearRequest: FakeRequest<undefined> = {
    error: null,
    onerror: null,
    onsuccess: null,
    result: undefined,
  };
  const transaction: FakeTransaction = {
    error: null,
    onabort: null,
    oncomplete: null,
    onerror: null,
    objectStore: vi.fn(),
  };
  const store = {
    clear: vi.fn(() => {
      queueMicrotask(() => {
        if (failClear) {
          clearRequest.error = new DOMException("Synthetic clear failure", "OperationError");
          clearRequest.onerror?.(new Event("error"));
          return;
        }
        clearRequest.onsuccess?.(new Event("success"));
        queueMicrotask(() => transaction.oncomplete?.(new Event("complete")));
      });
      return clearRequest as unknown as IDBRequest<undefined>;
    }),
  } as unknown as IDBObjectStore;
  transaction.objectStore = vi.fn(() => store);
  const database = {
    close: vi.fn(),
    transaction: vi.fn(() => transaction as unknown as IDBTransaction),
  } as unknown as IDBDatabase;
  const openRequest: FakeRequest<IDBDatabase> = {
    error: null,
    onerror: null,
    onsuccess: null,
    result: database,
  };
  const open = vi.fn(() => {
    queueMicrotask(() => openRequest.onsuccess?.(new Event("success")));
    return openRequest as unknown as IDBOpenDBRequest;
  });

  return {
    clear: store.clear,
    close: database.close,
    open,
    transaction: database.transaction,
  };
}

const track: Track = {
  id: "track-1",
  name: "A quiet signal",
  artists: [{ id: "artist-1", name: "ECHOFORM", avatarUrl: "https://example.test/avatar.jpg" }],
  album: { id: "album-1", name: "First light", artworkUrl: "https://example.test/artwork.jpg" },
  durationMs: 80_000,
  artworkUrl: "https://example.test/artwork.jpg",
  aliases: ["Signal"],
  explicit: false,
  availability: "playable",
  privilege: { fee: null, maxQuality: "standard" },
};

function createEntry(
  trackId: string,
  playedAt: number,
  playedMs = 30_000,
): ListeningHistoryEntry {
  return {
    completed: false,
    playedAt,
    playedMs,
    source: "local",
    track: { ...toStoredTrack({ ...track, id: trackId }), id: trackId },
    trackId,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listening history schema", () => {
  it("pins a versioned IndexedDB store and a recent-play index", () => {
    expect(historySchema).toEqual({
      databaseName: "echoform-listening-history",
      objectStoreName: "entries",
      playedAtIndexName: "playedAt",
      version: 1,
    });
  });

  it("whitelists track metadata and excludes audio-source-shaped fields", () => {
    const unsafeTrack = {
      ...track,
      audioUrl: "https://cdn.example.test/temporary-audio.mp3",
      source: { url: "https://cdn.example.test/temporary-audio.mp3" },
    } as Track;

    const stored = toStoredTrack(unsafeTrack);
    const serialized = JSON.stringify(stored);

    expect(stored.artists).toEqual([{ id: "artist-1", name: "ECHOFORM" }]);
    expect(serialized).not.toContain("temporary-audio.mp3");
    expect(serialized).not.toContain('"source"');
    expect(stored).not.toHaveProperty("audioUrl");
  });

  it("clears only the versioned entries store after an explicit local request", async () => {
    const database = createClearHistoryDatabaseHarness();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("indexedDB", { open: database.open });
    vi.stubGlobal("window", { dispatchEvent });

    await expect(clearListeningHistory()).resolves.toBeUndefined();

    expect(database.open).toHaveBeenCalledWith(
      historySchema.databaseName,
      historySchema.version,
    );
    expect(database.transaction).toHaveBeenCalledWith(historySchema.objectStoreName, "readwrite");
    expect(database.clear).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: listeningHistoryChangedEvent,
    }));
  });

  it("keeps the local UI unchanged when the history clear transaction fails", async () => {
    const database = createClearHistoryDatabaseHarness({ failClear: true });
    const dispatchEvent = vi.fn();
    vi.stubGlobal("indexedDB", { open: database.open });
    vi.stubGlobal("window", { dispatchEvent });

    await expect(clearListeningHistory()).rejects.toBeInstanceOf(ListeningHistoryStorageError);

    expect(database.clear).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});

describe("listening history record rules", () => {
  it("qualifies after 30 seconds or half of a known duration", () => {
    expect(hasReachedListeningHistoryThreshold({ durationMs: 80_000, playedMs: 29_999 })).toBe(false);
    expect(hasReachedListeningHistoryThreshold({ durationMs: 80_000, playedMs: 30_000 })).toBe(true);
    expect(hasReachedListeningHistoryThreshold({ durationMs: 20_000, playedMs: 9_999 })).toBe(false);
    expect(hasReachedListeningHistoryThreshold({ durationMs: 20_000, playedMs: 10_000 })).toBe(true);
    expect(hasReachedListeningHistoryThreshold({ durationMs: null, playedMs: 30_000 })).toBe(true);
  });

  it("caps seek jumps by elapsed wall time and emits only one capture per play session", () => {
    const recorder = createListeningHistoryRecorder();
    const observing = {
      currentTrack: track,
      durationMs: 200_000,
      loadRevision: 3,
      playbackStatus: "playing" as const,
    };

    expect(recorder.observe({ ...observing, currentTimeMs: 0 }, 0)).toBeNull();
    expect(recorder.observe({ ...observing, currentTimeMs: 70_000 }, 1_000)).toBeNull();
    expect(recorder.observe({ ...observing, currentTimeMs: 71_000 }, 2_000)).toBeNull();
    expect(recorder.observe({ ...observing, currentTimeMs: 99_000 }, 30_000)).toMatchObject({
      playedMs: 31_000,
      trackId: "track-1",
    });
    expect(recorder.observe({ ...observing, currentTimeMs: 73_000 }, 31_000)).toBeNull();
  });

  it("deduplicates a later qualified play and returns newest records first", () => {
    const first = createEntry("track-1", 100, 30_000);
    const later = createEntry("track-1", 400, 42_000);
    const other = createEntry("track-2", 300, 30_000);

    const deduplicated = upsertListeningHistoryEntries([first, other], later);

    expect(deduplicated).toHaveLength(2);
    expect(deduplicated.find((entry) => entry.trackId === "track-1")).toMatchObject({
      playedAt: 400,
      playedMs: 42_000,
    });
    expect(sortListeningHistoryEntries(deduplicated).map((entry) => entry.trackId)).toEqual([
      "track-1",
      "track-2",
    ]);
  });
});
