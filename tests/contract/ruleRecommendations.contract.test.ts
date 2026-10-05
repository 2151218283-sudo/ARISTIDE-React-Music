import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/lib/music/errors";
import { createHotSearchHandler } from "../../src/lib/music/hotSearchBff";
import type { PlaybackSource, Track } from "../../src/lib/music/models";
import {
  createRuleRecommendationRouteHandlers,
  type RuleRecommendationProvider,
} from "../../src/lib/music/ruleRecommendationBff";
import { InMemorySessionStore } from "../../src/lib/session/sessionStore";

const now = Date.UTC(2026, 9, 5, 9);
const track = (id: string, artistId = id): Track => ({
  id,
  name: `Track ${id}`,
  artists: [{ id: artistId, name: `Artist ${artistId}`, avatarUrl: null }],
  album: { id: `album-${id}`, name: `Album ${id}`, artworkUrl: null },
  durationMs: 180_000,
  artworkUrl: null,
  aliases: [],
  explicit: false,
  availability: "unknown",
  privilege: { fee: 0, maxQuality: "standard" },
});
const source: PlaybackSource = {
  url: "synthetic-source",
  expiresAt: Number.MAX_SAFE_INTEGER,
  quality: "standard",
  codec: "mp3",
  bitrate: 128_000,
  sampleRate: 44_100,
  sizeBytes: 1,
  corsMode: "unavailable",
};

function authenticatedSession(store: InMemorySessionStore, userId = "9001"): string {
  const session = store.create();
  const challenge = store.beginQrChallenge(session.id, "synthetic-challenge");
  if (!challenge) throw new Error("Missing synthetic challenge");
  store.authorizeQrChallenge(session.id, challenge.challengeId, "synthetic-server-credential");
  store.setAuthenticatedUser(session.id, {
    id: userId, nickname: "Synthetic Listener", avatarUrl: null, signature: null,
  });
  return session.id;
}

function request(sessionId: string, history: unknown = []): Request {
  return new Request("http://localhost/api/recommendations/rules", {
    method: "POST",
    headers: { cookie: `echoform.sid=${sessionId}`, "content-type": "application/json" },
    body: JSON.stringify({ history }),
  });
}

function provider(overrides: Partial<RuleRecommendationProvider> = {}): RuleRecommendationProvider {
  return {
    getLikedTrackIds: vi.fn(async () => ["101"]),
    getTrack: vi.fn(async (id) => track(id)),
    getSimilarTracks: vi.fn(async () => [track("101"), track("201", "a"), track("202", "a"), track("203", "a"), track("204", "b")]),
    getPlaybackSource: vi.fn(async () => source),
    ...overrides,
  };
}

describe("T026 rule recommendation BFF", () => {
  it("requires an authenticated Real session before reading private signals", async () => {
    const store = new InMemorySessionStore({ now: () => now });
    const createProvider = vi.fn(() => provider());
    const handlers = createRuleRecommendationRouteHandlers({ store, createProvider, now: () => now });
    const guest = store.create();
    const demo = authenticatedSession(store);
    store.setMode(demo, "demo");

    for (const id of [guest.id, demo]) {
      const response = await handlers.rules(request(id));
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });
    }
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("filters liked, recent, unavailable and same-artist candidates, then caches complete results by day", async () => {
    const store = new InMemorySessionStore({ now: () => now });
    const id = authenticatedSession(store);
    const real = provider({
      getSimilarTracks: vi.fn(async () => [
        track("101"), track("301"), track("201", "a"), track("202", "a"), track("203", "a"), track("204", "b"),
      ]),
      getPlaybackSource: vi.fn(async (trackId) => {
        if (trackId === "204") throw new AppError("TRACK_UNAVAILABLE", "Unavailable");
        return source;
      }),
    });
    const handlers = createRuleRecommendationRouteHandlers({ store, createProvider: () => real, now: () => now });
    const history = [{ trackId: "301", playedAt: now - 1_000 }];
    const first = await handlers.rules(request(id, history));
    const body = await first.json();

    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({
      ok: true, meta: { mode: "real" },
      data: { source: "real", date: "2026-10-05", historySampleSize: 1, likedSampleSize: 1,
        failedSeedCount: 0, failedAvailabilityCount: 0 },
    });
    expect(body.data.items.map((item: { track: Track }) => item.track.id)).toEqual(["201", "202"]);
    expect(body.data.items.every((item: { track: Track }) => item.track.availability === "playable")).toBe(true);
    expect(JSON.stringify(body)).not.toContain(source.url);
    const firstReads = vi.mocked(real.getSimilarTracks).mock.calls.length;
    const second = await handlers.rules(request(id, history));
    expect(second.status).toBe(200);
    expect(vi.mocked(real.getSimilarTracks).mock.calls).toHaveLength(firstReads);
    expect(store.getRuleRecommendations(id, [...store.get(id)!.ruleRecommendations.keys()][0])).not.toBeNull();
  });

  it("keeps partial seed failures visible and does not cache them", async () => {
    const store = new InMemorySessionStore({ now: () => now });
    const id = authenticatedSession(store);
    const real = provider({
      getSimilarTracks: vi.fn(async (trackId) => {
        if (trackId === "301") throw new AppError("UPSTREAM_UNAVAILABLE", "Synthetic failure", { retryable: true });
        return [track("201")];
      }),
    });
    const handlers = createRuleRecommendationRouteHandlers({ store, createProvider: () => real, now: () => now });
    const response = await handlers.rules(request(id, [{ trackId: "301", playedAt: now - 1_000 }]));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { failedSeedCount: 1, items: [{ track: { id: "201" } }] } });
    expect(store.get(id)?.ruleRecommendations.size).toBe(0);
  });

  it("reports partial source-check failures without caching incomplete results", async () => {
    const store = new InMemorySessionStore({ now: () => now });
    const id = authenticatedSession(store);
    const real = provider({
      getSimilarTracks: vi.fn(async () => [track("201"), track("202")]),
      getPlaybackSource: vi.fn(async (trackId) => {
        if (trackId === "201") throw new AppError("UPSTREAM_TIMEOUT", "Synthetic timeout", { retryable: true });
        return source;
      }),
    });
    const handlers = createRuleRecommendationRouteHandlers({ store, createProvider: () => real, now: () => now });
    const response = await handlers.rules(request(id));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { failedAvailabilityCount: 1, items: [{ track: { id: "202" } }] },
    });
    expect(store.get(id)?.ruleRecommendations.size).toBe(0);
  });

  it("does not disguise authentication failures as partial seed or source failures", async () => {
    for (const stage of ["seed", "source"] as const) {
      const store = new InMemorySessionStore({ now: () => now });
      const id = authenticatedSession(store);
      const real = provider(stage === "seed" ? {
        getSimilarTracks: vi.fn(async () => {
          throw new AppError("SESSION_EXPIRED", "Synthetic expired session");
        }),
      } : {
        getSimilarTracks: vi.fn(async () => [track("201")]),
        getPlaybackSource: vi.fn(async () => {
          throw new AppError("AUTH_REQUIRED", "Synthetic auth failure");
        }),
      });
      const handlers = createRuleRecommendationRouteHandlers({ store, createProvider: () => real, now: () => now });
      const response = await handlers.rules(request(id));
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: stage === "seed" ? "SESSION_EXPIRED" : "AUTH_REQUIRED" },
      });
      expect(store.get(id)?.ruleRecommendations.size).toBe(0);
    }
  });

  it("bounds liked-list reads and returns a retryable timeout", async () => {
    const store = new InMemorySessionStore({ now: () => now });
    const id = authenticatedSession(store);
    const real = provider({ getLikedTrackIds: async () => await new Promise<string[]>(() => undefined) });
    const handlers = createRuleRecommendationRouteHandlers({
      store, createProvider: () => real, now: () => now, timeoutMs: { default: 1, source: 1 },
    });
    const response = await handlers.rules(request(id));
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      ok: false, error: { code: "UPSTREAM_TIMEOUT", retryable: true },
    });
  });

  it("does not return or cache an in-flight Real result after switching to Demo", async () => {
    const store = new InMemorySessionStore({ now: () => now });
    const id = authenticatedSession(store);
    let release!: (tracks: Track[]) => void;
    const getSimilarTracks = vi.fn(async () => await new Promise<Track[]>((resolve) => {
      release = resolve;
    }));
    const real = provider({ getSimilarTracks });
    const handlers = createRuleRecommendationRouteHandlers({ store, createProvider: () => real, now: () => now });
    const pending = handlers.rules(request(id));
    await vi.waitFor(() => expect(getSimilarTracks).toHaveBeenCalledOnce());
    store.setMode(id, "demo");
    release([track("201")]);
    const response = await pending;
    expect(response.status).toBe(401);
    expect(store.get(id)?.ruleRecommendations.size).toBe(0);
    expect(real.getPlaybackSource).not.toHaveBeenCalled();
  });

  it("reports a changed session before a simultaneous total source-check failure", async () => {
    const store = new InMemorySessionStore({ now: () => now });
    const id = authenticatedSession(store);
    let release!: () => void;
    const getPlaybackSource = vi.fn(async () => await new Promise<PlaybackSource>((_, reject) => {
      release = () => reject(new AppError("UPSTREAM_TIMEOUT", "Synthetic timeout", { retryable: true }));
    }));
    const real = provider({
      getSimilarTracks: vi.fn(async () => [track("201")]),
      getPlaybackSource,
    });
    const handlers = createRuleRecommendationRouteHandlers({ store, createProvider: () => real, now: () => now });
    const pending = handlers.rules(request(id));
    await vi.waitFor(() => expect(getPlaybackSource).toHaveBeenCalledOnce());
    store.setMode(id, "demo");
    release();
    const response = await pending;
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: "SESSION_EXPIRED" } });
    expect(store.get(id)?.ruleRecommendations.size).toBe(0);
  });

  it("deduplicates local history using the latest qualified play", async () => {
    const store = new InMemorySessionStore({ now: () => now });
    const id = authenticatedSession(store);
    const real = provider({ getLikedTrackIds: vi.fn(async () => []) });
    const handlers = createRuleRecommendationRouteHandlers({ store, createProvider: () => real, now: () => now });
    const response = await handlers.rules(request(id, [
      { trackId: "301", playedAt: now - 10_000 },
      { trackId: "302", playedAt: now - 2_000 },
      { trackId: "301", playedAt: now - 1_000 },
    ]));
    expect(response.status).toBe(200);
    expect(vi.mocked(real.getTrack).mock.calls.map(([trackId]) => trackId)).toEqual(["301", "302"]);
    await expect(response.json()).resolves.toMatchObject({ data: { historySampleSize: 2 } });
  });

  it("rejects invalid local evidence and surfaces total source failures without Demo fallback", async () => {
    const store = new InMemorySessionStore({ now: () => now });
    const id = authenticatedSession(store);
    const real = provider({ getSimilarTracks: vi.fn(async () => { throw new Error("Synthetic failure"); }) });
    const handlers = createRuleRecommendationRouteHandlers({ store, createProvider: () => real, now: () => now });
    const invalid = await handlers.rules(request(id, [{ trackId: "other-user", playedAt: now }]));
    expect(invalid.status).toBe(400);
    expect(real.getLikedTrackIds).not.toHaveBeenCalled();
    const failed = await handlers.rules(request(id));
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toMatchObject({ ok: false, error: { code: "UPSTREAM_UNAVAILABLE" } });
    expect(store.get(id)?.ruleRecommendations.size).toBe(0);
  });
});

describe("T026 hot search BFF", () => {
  it("returns normalized Real terms and an explicit Demo empty state", async () => {
    const store = new InMemorySessionStore({ now: () => now });
    const id = store.create().id;
    const getHotSearches = vi.fn(async () => [{ rank: 1, text: "Synthetic term" }]);
    const handler = createHotSearchHandler({ store, createProvider: () => ({ getHotSearches }), now: () => now });
    const real = await handler(new Request("http://localhost/api/search/hot", { headers: { cookie: `echoform.sid=${id}` } }));
    expect(real.headers.get("Cache-Control")).toBe("no-store");
    await expect(real.json()).resolves.toMatchObject({ data: { source: "real", items: [{ text: "Synthetic term" }] } });
    store.setMode(id, "demo");
    const demo = await handler(new Request("http://localhost/api/search/hot", { headers: { cookie: `echoform.sid=${id}` } }));
    await expect(demo.json()).resolves.toMatchObject({ data: { source: "demo", items: [] } });
    expect(getHotSearches).toHaveBeenCalledOnce();
  });

  it("exposes a Real read failure instead of synthesized terms", async () => {
    const store = new InMemorySessionStore({ now: () => now });
    const handler = createHotSearchHandler({ store, createProvider: () => ({
      getHotSearches: async () => { throw new AppError("UPSTREAM_UNAVAILABLE", "Synthetic failure", { retryable: true }); },
    }) });
    const response = await handler(new Request("http://localhost/api/search/hot"));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: "UPSTREAM_UNAVAILABLE" } });
  });

  it("times out an unresponsive Real hot-search read", async () => {
    const store = new InMemorySessionStore({ now: () => now });
    const handler = createHotSearchHandler({
      store, timeoutMs: 1,
      createProvider: () => ({ getHotSearches: async () => await new Promise(() => undefined) }),
    });
    const response = await handler(new Request("http://localhost/api/search/hot"));
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      ok: false, error: { code: "UPSTREAM_TIMEOUT", retryable: true },
    });
  });
});
