import { describe, expect, it } from "vitest";

import type { PlaybackSource, Track } from "../../src/lib/music/models";
import {
  createInitialPlayerSnapshot,
  isSourceNearExpiry,
  playerError,
  reducePlayerSnapshot,
  validatePlayerSnapshot,
  type PlayerEvent,
  type PlayerSnapshot,
  type QueueItem,
} from "../../src/lib/player";

function track(id: string): Track {
  return {
    id,
    name: `Track ${id}`,
    artists: [{ id: `artist-${id}`, name: "Artist", avatarUrl: null }],
    album: { id: `album-${id}`, name: "Album", artworkUrl: null },
    durationMs: 120_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability: "playable",
    privilege: { fee: 0, maxQuality: "standard" },
  };
}

function item(id: string): QueueItem {
  return { queueItemId: `queue-${id}`, track: track(id), sourceContext: "manual" };
}

function source(expiresAt = 1_000_000): PlaybackSource {
  return {
    url: "memory-only-source",
    expiresAt,
    quality: "standard",
    codec: "mp3",
    bitrate: 128_000,
    sampleRate: 44_100,
    sizeBytes: null,
    corsMode: "anonymous",
  };
}

function event(snapshot: PlayerSnapshot, value: Omit<PlayerEvent, "revision">): PlayerEvent {
  return { ...value, revision: snapshot.loadRevision } as PlayerEvent;
}

function readySnapshot(queue: readonly QueueItem[] = [item("a")]): PlayerSnapshot {
  let snapshot = reducePlayerSnapshot(createInitialPlayerSnapshot(), {
    type: "LOAD_TRACK",
    track: queue[0].track,
    queue,
    autoplay: false,
  });
  snapshot = reducePlayerSnapshot(snapshot, {
    type: "SOURCE_RESOLVED",
    revision: snapshot.loadRevision,
    source: source(),
  });
  return reducePlayerSnapshot(snapshot, {
    type: "MEDIA_LOADEDMETADATA",
    revision: snapshot.loadRevision,
    durationMs: 120_000,
  });
}

describe("player reducer lifecycle", () => {
  it("moves idle -> load -> ready -> play -> pause -> play -> ended", () => {
    let snapshot = readySnapshot();
    expect(snapshot.playbackStatus).toBe("ready");

    snapshot = reducePlayerSnapshot(snapshot, { type: "PLAY" });
    expect(snapshot.playbackStatus).toBe("ready");
    expect(snapshot.desiredPlayback).toBe("playing");

    snapshot = reducePlayerSnapshot(snapshot, event(snapshot, { type: "MEDIA_PLAY" }));
    expect(snapshot.playbackStatus).toBe("playing");

    snapshot = reducePlayerSnapshot(snapshot, { type: "PAUSE", reason: "user" });
    expect(snapshot).toMatchObject({ playbackStatus: "paused", desiredPlayback: "paused" });

    snapshot = reducePlayerSnapshot(snapshot, { type: "PLAY" });
    snapshot = reducePlayerSnapshot(snapshot, event(snapshot, { type: "MEDIA_PLAY" }));
    snapshot = reducePlayerSnapshot(snapshot, event(snapshot, { type: "MEDIA_ENDED" }));
    expect(snapshot).toMatchObject({ playbackStatus: "ended", desiredPlayback: "paused" });
  });

  it("keeps buffering and stalled orthogonal to playback intent", () => {
    let snapshot = readySnapshot();
    snapshot = reducePlayerSnapshot(snapshot, { type: "PLAY" });
    snapshot = reducePlayerSnapshot(snapshot, event(snapshot, { type: "MEDIA_PLAY" }));
    snapshot = reducePlayerSnapshot(snapshot, event(snapshot, { type: "MEDIA_WAITING" }));
    expect(snapshot).toMatchObject({ playbackStatus: "playing", networkStatus: "buffering" });

    snapshot = reducePlayerSnapshot(snapshot, event(snapshot, { type: "MEDIA_CANPLAY" }));
    expect(snapshot.networkStatus).toBe("idle");
    snapshot = reducePlayerSnapshot(snapshot, event(snapshot, { type: "MEDIA_STALLED" }));
    expect(snapshot).toMatchObject({ playbackStatus: "playing", networkStatus: "stalled" });
  });

  it("ignores ended, error, and canplay from an old revision", () => {
    const queue = [item("a"), item("b")];
    let snapshot = readySnapshot(queue);
    const oldRevision = snapshot.loadRevision;
    snapshot = reducePlayerSnapshot(snapshot, {
      type: "LOAD_TRACK",
      track: queue[1].track,
      queue,
      autoplay: true,
    });

    for (const stale of [
      { type: "MEDIA_ENDED", revision: oldRevision },
      { type: "MEDIA_ERROR", revision: oldRevision, mediaCode: 2 },
      { type: "MEDIA_CANPLAY", revision: oldRevision },
    ] as PlayerEvent[]) {
      expect(reducePlayerSnapshot(snapshot, stale)).toBe(snapshot);
    }
  });

  it("represents autoplay rejection as a recoverable paused hint", () => {
    let snapshot = readySnapshot();
    snapshot = reducePlayerSnapshot(snapshot, { type: "PLAY" });
    snapshot = reducePlayerSnapshot(snapshot, {
      type: "PLAY_REJECTED",
      revision: snapshot.loadRevision,
      name: "NotAllowedError",
    });

    expect(snapshot).toMatchObject({
      playbackStatus: "paused",
      desiredPlayback: "paused",
      error: { code: "AUTOPLAY_BLOCKED", fatal: false },
    });
    snapshot = reducePlayerSnapshot(snapshot, { type: "PLAY" });
    expect(snapshot.error).toBeNull();
  });
});

describe("player reducer seek and queue policy", () => {
  it("clamps seek boundaries, rejects unknown duration, and preserves pause intent", () => {
    const unknown = reducePlayerSnapshot(createInitialPlayerSnapshot(), {
      type: "LOAD_TRACK",
      track: track("a"),
      autoplay: true,
    });
    expect(reducePlayerSnapshot(unknown, { type: "SEEK_COMMIT", timeMs: 5_000 })).toBe(unknown);

    let snapshot = readySnapshot();
    snapshot = reducePlayerSnapshot(snapshot, { type: "PLAY" });
    snapshot = reducePlayerSnapshot(snapshot, { type: "SEEK_START" });
    snapshot = reducePlayerSnapshot(snapshot, { type: "PAUSE", reason: "user" });
    snapshot = reducePlayerSnapshot(snapshot, { type: "SEEK_COMMIT", timeMs: 999_000 });
    expect(snapshot).toMatchObject({
      currentTimeMs: 120_000,
      seekStatus: "seeking",
      desiredPlayback: "paused",
    });
    snapshot = reducePlayerSnapshot(snapshot, event(snapshot, { type: "MEDIA_SEEKED" }));
    expect(snapshot).toMatchObject({ seekStatus: "idle", desiredPlayback: "paused" });
  });

  it("honors sequential start, previous threshold, and finite end", () => {
    const queue = [item("a"), item("b")];
    let snapshot = readySnapshot(queue);
    snapshot = reducePlayerSnapshot(snapshot, {
      type: "MEDIA_TIME",
      revision: snapshot.loadRevision,
      currentTimeMs: 4_000,
    });
    snapshot = reducePlayerSnapshot(snapshot, { type: "PREVIOUS" });
    expect(snapshot.currentTimeMs).toBe(0);
    expect(snapshot.currentIndex).toBe(0);

    snapshot = reducePlayerSnapshot(snapshot, { type: "NEXT", origin: "user" });
    expect(snapshot).toMatchObject({ currentIndex: 1, playbackStatus: "loading" });
    snapshot = reducePlayerSnapshot(snapshot, { type: "NEXT", origin: "user" });
    expect(snapshot.playbackStatus).toBe("ended");
    snapshot = reducePlayerSnapshot(snapshot, { type: "PREVIOUS" });
    expect(snapshot.currentIndex).toBe(0);
  });

  it("uses every shuffle item once and history for previous", () => {
    const queue = [item("a"), item("b"), item("c")];
    const random = () => 0;
    let snapshot = readySnapshot(queue);
    snapshot = reducePlayerSnapshot(snapshot, { type: "SET_MODE", mode: "shuffle" }, { random });
    const firstBag = snapshot.shuffleBag;
    expect(new Set(firstBag).size).toBe(2);

    snapshot = reducePlayerSnapshot(snapshot, { type: "NEXT", origin: "user" }, { random });
    const secondIndex = snapshot.currentIndex;
    snapshot = reducePlayerSnapshot(snapshot, { type: "NEXT", origin: "user" }, { random });
    expect(snapshot.currentIndex).not.toBe(secondIndex);
    snapshot = reducePlayerSnapshot(snapshot, { type: "NEXT", origin: "user" }, { random });
    expect(snapshot.playbackStatus).toBe("ended");

    snapshot = reducePlayerSnapshot(snapshot, { type: "PREVIOUS" }, { random });
    expect(snapshot.currentIndex).toBe(secondIndex);
  });

  it("does not repopulate played shuffle items when preserving the current queue item", () => {
    const queue = [item("a"), item("b"), item("c")];
    const random = () => 0;
    let snapshot = readySnapshot(queue);
    snapshot = reducePlayerSnapshot(snapshot, { type: "SET_MODE", mode: "shuffle" }, { random });
    snapshot = reducePlayerSnapshot(snapshot, { type: "NEXT", origin: "user" }, { random });
    const playedId = snapshot.playbackHistory[0];
    const currentId = snapshot.queue[snapshot.currentIndex].queueItemId;

    snapshot = reducePlayerSnapshot(snapshot, {
      type: "SET_QUEUE",
      queue: [queue[0], queue[1], queue[2], item("d")],
    }, { random });

    expect(snapshot.queue[snapshot.currentIndex].queueItemId).toBe(currentId);
    expect(snapshot.shuffleBag).not.toContain(playedId);
    expect(snapshot.shuffleBag).toContain("queue-d");
  });

  it("repeats only on natural end and lets manual next move", () => {
    const queue = [item("a"), item("b")];
    let snapshot = readySnapshot(queue);
    snapshot = reducePlayerSnapshot(snapshot, { type: "SET_MODE", mode: "repeat-one" });
    snapshot = reducePlayerSnapshot(snapshot, { type: "PLAY" });
    snapshot = reducePlayerSnapshot(snapshot, event(snapshot, { type: "MEDIA_PLAY" }));
    snapshot = reducePlayerSnapshot(snapshot, event(snapshot, { type: "MEDIA_ENDED" }));
    expect(snapshot).toMatchObject({ currentIndex: 0, currentTimeMs: 0, desiredPlayback: "playing" });

    snapshot = reducePlayerSnapshot(snapshot, { type: "NEXT", origin: "user" });
    expect(snapshot.currentIndex).toBe(1);
  });

  it("preserves the current queue item and handles enqueue/remove deterministically", () => {
    const queue = [item("a"), item("b")];
    let snapshot = readySnapshot(queue);
    snapshot = reducePlayerSnapshot(snapshot, { type: "NEXT", origin: "user" });
    const revision = snapshot.loadRevision;
    snapshot = reducePlayerSnapshot(snapshot, {
      type: "SET_QUEUE",
      queue: [item("x"), queue[1], item("c")],
    });
    expect(snapshot).toMatchObject({ currentIndex: 1, loadRevision: revision });

    snapshot = reducePlayerSnapshot(snapshot, { type: "ENQUEUE", item: item("d") });
    expect(snapshot.queue).toHaveLength(4);
    snapshot = reducePlayerSnapshot(snapshot, {
      type: "REMOVE_FROM_QUEUE",
      queueItemId: "queue-b",
    });
    expect(snapshot).toMatchObject({ currentIndex: 1, currentTrack: { id: "c" } });
  });
});

describe("player reducer timers and invariants", () => {
  it("fades only the temporary gain and restores it after cancellation", () => {
    let snapshot = readySnapshot();
    snapshot = reducePlayerSnapshot(snapshot, { type: "SET_VOLUME", volume: 0.7 });
    snapshot = reducePlayerSnapshot(snapshot, {
      type: "SET_SLEEP_TIMER",
      timer: { kind: "after-duration", firesAt: 10_000 },
    });
    snapshot = reducePlayerSnapshot(snapshot, { type: "SLEEP_TIMER_TICK", now: 8_500 });
    expect(snapshot.sleepFadeGain).toBe(0.5);
    expect(snapshot.volume).toBe(0.7);
    snapshot = reducePlayerSnapshot(snapshot, { type: "SET_SLEEP_TIMER", timer: null });
    expect(snapshot.sleepFadeGain).toBe(1);
  });

  it("stops end-of-track timer without advancing the queue", () => {
    const queue = [item("a"), item("b")];
    let snapshot = readySnapshot(queue);
    snapshot = reducePlayerSnapshot(snapshot, { type: "SET_SLEEP_TIMER", timer: { kind: "end-of-track" } });
    snapshot = reducePlayerSnapshot(snapshot, { type: "PLAY" });
    snapshot = reducePlayerSnapshot(snapshot, event(snapshot, { type: "MEDIA_PLAY" }));
    snapshot = reducePlayerSnapshot(snapshot, event(snapshot, { type: "MEDIA_ENDED" }));
    expect(snapshot).toMatchObject({ currentIndex: 0, playbackStatus: "paused", sleepTimer: null });
  });

  it("uses remaining track time for end-of-track fade and clears timers on unload", () => {
    let snapshot = readySnapshot();
    snapshot = reducePlayerSnapshot(snapshot, {
      type: "MEDIA_TIME",
      revision: snapshot.loadRevision,
      currentTimeMs: 118_500,
    });
    snapshot = reducePlayerSnapshot(snapshot, { type: "SET_SLEEP_TIMER", timer: { kind: "end-of-track" } });
    snapshot = reducePlayerSnapshot(snapshot, { type: "SLEEP_TIMER_TICK", now: 0 });
    expect(snapshot.sleepFadeGain).toBe(0.5);
    snapshot = reducePlayerSnapshot(snapshot, { type: "UNLOAD" });
    expect(snapshot).toMatchObject({ playbackStatus: "idle", sleepTimer: null, sleepFadeGain: 1 });
  });

  it("fires a duration timer from an absolute background tick without changing saved volume", () => {
    let snapshot = readySnapshot();
    snapshot = reducePlayerSnapshot(snapshot, { type: "SET_VOLUME", volume: 0.6 });
    snapshot = reducePlayerSnapshot(snapshot, { type: "PLAY" });
    snapshot = reducePlayerSnapshot(snapshot, event(snapshot, { type: "MEDIA_PLAY" }));
    snapshot = reducePlayerSnapshot(snapshot, {
      type: "SET_SLEEP_TIMER",
      timer: { kind: "after-duration", firesAt: 10_000 },
    });
    snapshot = reducePlayerSnapshot(snapshot, { type: "SLEEP_TIMER_TICK", now: 12_000 });
    expect(snapshot.sleepFadeGain).toBe(0);
    snapshot = reducePlayerSnapshot(snapshot, { type: "SLEEP_TIMER_FIRED" });
    expect(snapshot).toMatchObject({
      playbackStatus: "paused",
      desiredPlayback: "paused",
      sleepTimer: null,
      sleepFadeGain: 1,
      volume: 0.6,
    });
  });

  it("detects invalid snapshots and recognizes the source refresh window", () => {
    const invalid = {
      ...createInitialPlayerSnapshot(),
      playbackStatus: "playing" as const,
    };
    expect(validatePlayerSnapshot(invalid)).not.toEqual([]);
    expect(isSourceNearExpiry(source(100_000), 40_000)).toBe(true);
    expect(isSourceNearExpiry(source(100_001), 40_000)).toBe(false);
    expect(playerError("NETWORK_ERROR", "failed", { retryable: true })).toMatchObject({
      retryable: true,
      fatal: true,
    });
  });
});
