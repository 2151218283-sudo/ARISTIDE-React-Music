import { describe, expect, it, vi } from "vitest";

import type { PlaybackSource, Track } from "../../src/lib/music/models";
import {
  createPlayerController,
  getStalledRecoveryPlan,
  playerError,
  type PlayerController,
  type QueueItem,
} from "../../src/lib/player";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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

function source(id: string, expiresAt = 9_999_999_999_999): PlaybackSource {
  return {
    url: `memory-${id}`,
    expiresAt,
    quality: "standard",
    codec: "mp3",
    bitrate: 128_000,
    sampleRate: 44_100,
    sizeBytes: null,
    corsMode: "anonymous",
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadReady(
  controller: PlayerController,
  queue: readonly QueueItem[],
  autoplay = false,
): Promise<void> {
  controller.dispatch({
    type: "LOAD_TRACK",
    track: queue[0].track,
    queue,
    autoplay,
  });
  await flushPromises();
  controller.dispatch({
    type: "MEDIA_LOADEDMETADATA",
    revision: controller.getSnapshot().loadRevision,
    durationMs: 120_000,
  });
}

describe("player controller revision and intent guards", () => {
  it("allows only C to resolve after rapid A/B/C loads", async () => {
    const requests = new Map<string, Deferred<PlaybackSource>>();
    const controller = createPlayerController({
      resolveSource: (value) => {
        const request = deferred<PlaybackSource>();
        requests.set(value.id, request);
        return request.promise;
      },
    });

    controller.dispatch({ type: "LOAD_TRACK", track: track("a"), autoplay: true });
    controller.dispatch({ type: "LOAD_TRACK", track: track("b"), autoplay: true });
    controller.dispatch({ type: "LOAD_TRACK", track: track("c"), autoplay: true });
    requests.get("a")?.resolve(source("a"));
    requests.get("b")?.resolve(source("b"));
    requests.get("c")?.resolve(source("c"));
    await flushPromises();

    expect(controller.getSnapshot()).toMatchObject({
      currentTrack: { id: "c" },
      source: { url: "memory-c" },
      loadRevision: 3,
    });
  });

  it("does not let a pending play promise override pause", async () => {
    const pendingPlay = deferred<void>();
    const requestPause = vi.fn();
    const controller = createPlayerController({
      resolveSource: async (value) => source(value.id),
      requestPlay: () => pendingPlay.promise,
      requestPause,
    });
    await loadReady(controller, [item("a")]);

    controller.dispatch({ type: "PLAY" });
    controller.dispatch({ type: "PAUSE", reason: "user" });
    pendingPlay.resolve();
    await flushPromises();

    expect(controller.getSnapshot()).toMatchObject({
      playbackStatus: "paused",
      desiredPlayback: "paused",
    });
    expect(requestPause).toHaveBeenCalledTimes(1);
  });

  it("waits for MEDIA_PLAY even after requestPlay resolves", async () => {
    const requestPlay = vi.fn(async () => undefined);
    const controller = createPlayerController({
      resolveSource: async (value) => source(value.id),
      requestPlay,
    });
    await loadReady(controller, [item("a")]);
    controller.dispatch({ type: "PLAY" });
    await flushPromises();
    expect(controller.getSnapshot().playbackStatus).toBe("ready");
    controller.dispatch({ type: "PLAY" });
    expect(requestPlay).toHaveBeenCalledTimes(1);

    controller.dispatch({
      type: "MEDIA_PLAY",
      revision: controller.getSnapshot().loadRevision,
    });
    expect(controller.getSnapshot().playbackStatus).toBe("playing");
  });
});

describe("player controller recovery", () => {
  it("refreshes a source before play and fails after one bounded refresh", async () => {
    let calls = 0;
    const refreshFailure = playerError("SOURCE_EXPIRED", "expired", { retryable: true });
    const controller = createPlayerController({
      now: () => 50_000,
      resolveSource: async (value) => {
        calls += 1;
        if (calls > 1) {
          throw refreshFailure;
        }
        return source(value.id, 100_000);
      },
    });
    await loadReady(controller, [item("a")]);

    controller.dispatch({ type: "PLAY" });
    await flushPromises();
    expect(calls).toBe(2);
    expect(controller.getSnapshot()).toMatchObject({
      playbackStatus: "error",
      sourceRefreshCount: 1,
      error: { code: "SOURCE_EXPIRED" },
    });
  });

  it("chooses refresh, one controlled reload, then failure for stalled recovery", async () => {
    const expiring = createPlayerController({
      now: () => 50_000,
      resolveSource: async (value) => source(value.id, 100_000),
    });
    await loadReady(expiring, [item("a")], true);
    expiring.dispatch({
      type: "MEDIA_STALLED",
      revision: expiring.getSnapshot().loadRevision,
    });
    expect(getStalledRecoveryPlan(expiring.getSnapshot(), 50_000)).toBe("refresh-source");
    expiring.recoverStall();
    expect(expiring.getSnapshot()).toMatchObject({
      playbackStatus: "loading",
      sourceRefreshCount: 1,
    });

    const stable = createPlayerController({
      now: () => 50_000,
      resolveSource: async (value) => source(value.id, 500_000),
    });
    await loadReady(stable, [item("a")], true);
    stable.dispatch({
      type: "MEDIA_STALLED",
      revision: stable.getSnapshot().loadRevision,
    });
    expect(getStalledRecoveryPlan(stable.getSnapshot(), 50_000)).toBe("reload-source");
    stable.recoverStall();
    expect(stable.getSnapshot()).toMatchObject({
      playbackStatus: "loading",
      controlledReloadCount: 1,
    });
    stable.dispatch({
      type: "MEDIA_STALLED",
      revision: stable.getSnapshot().loadRevision,
    });
    stable.recoverStall();
    expect(stable.getSnapshot()).toMatchObject({
      playbackStatus: "error",
      error: { code: "NETWORK_ERROR" },
    });
  });

  it("maps autoplay rejection without retrying automatically", async () => {
    const requestPlay = vi.fn(async () => {
      const error = new Error("blocked");
      error.name = "NotAllowedError";
      throw error;
    });
    const controller = createPlayerController({
      resolveSource: async (value) => source(value.id),
      requestPlay,
    });
    await loadReady(controller, [item("a")], true);
    await flushPromises();

    expect(requestPlay).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      playbackStatus: "paused",
      desiredPlayback: "paused",
      error: { code: "AUTOPLAY_BLOCKED" },
    });
  });

  it("refreshes once for an unsupported source before reporting the media error", async () => {
    let calls = 0;
    const controller = createPlayerController({
      resolveSource: async (value) => {
        calls += 1;
        return source(value.id);
      },
    });
    await loadReady(controller, [item("a")]);
    controller.dispatch({
      type: "MEDIA_ERROR",
      revision: controller.getSnapshot().loadRevision,
      mediaCode: 4,
    });
    await flushPromises();
    expect(calls).toBe(2);
    expect(controller.getSnapshot()).toMatchObject({
      playbackStatus: "loading",
      sourceRefreshCount: 1,
      source: { url: "memory-a" },
    });

    controller.dispatch({
      type: "MEDIA_ERROR",
      revision: controller.getSnapshot().loadRevision,
      mediaCode: 4,
    });
    expect(controller.getSnapshot()).toMatchObject({
      playbackStatus: "error",
      error: { code: "SOURCE_UNSUPPORTED" },
    });
  });
});

describe("player controller bounded automatic skip", () => {
  it("skips one unavailable item and stops at the next playable track", async () => {
    const queue = [item("a"), item("b"), item("c")];
    const controller = createPlayerController({
      resolveSource: async (value) => {
        if (value.id === "b") {
          throw playerError("TRACK_UNAVAILABLE", "unavailable");
        }
        return source(value.id);
      },
    });
    await loadReady(controller, queue, true);
    controller.dispatch({
      type: "MEDIA_ENDED",
      revision: controller.getSnapshot().loadRevision,
    });
    await flushPromises();

    expect(controller.getSnapshot()).toMatchObject({
      currentTrack: { id: "c" },
      source: { url: "memory-c" },
    });
  });

  it("skips multiple unavailable items without revisiting them", async () => {
    const queue = [item("a"), item("b"), item("c"), item("d")];
    const calls: string[] = [];
    const controller = createPlayerController({
      resolveSource: async (value) => {
        calls.push(value.id);
        if (value.id === "b" || value.id === "c") {
          throw playerError("TRACK_UNAVAILABLE", "unavailable");
        }
        return source(value.id);
      },
    });
    await loadReady(controller, queue, true);
    controller.dispatch({
      type: "MEDIA_ENDED",
      revision: controller.getSnapshot().loadRevision,
    });
    await flushPromises();

    expect(controller.getSnapshot().currentTrack?.id).toBe("d");
    expect(calls).toEqual(["a", "b", "c", "d"]);
  });

  it("reports QUEUE_EXHAUSTED after at most one finite queue pass", async () => {
    const queue = [item("a"), item("b"), item("c")];
    const calls: string[] = [];
    const controller = createPlayerController({
      resolveSource: async (value) => {
        calls.push(value.id);
        if (value.id !== "a") {
          throw playerError("TRACK_UNAVAILABLE", "unavailable");
        }
        return source(value.id);
      },
    });
    await loadReady(controller, queue, true);
    controller.dispatch({
      type: "MEDIA_ENDED",
      revision: controller.getSnapshot().loadRevision,
    });
    await flushPromises();

    expect(calls).toEqual(["a", "b", "c"]);
    expect(controller.getSnapshot()).toMatchObject({
      playbackStatus: "error",
      error: { code: "QUEUE_EXHAUSTED" },
    });
  });
});
