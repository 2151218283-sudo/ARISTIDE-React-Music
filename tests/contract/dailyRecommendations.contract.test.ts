import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/lib/music/errors";
import {
  createDailyRecommendationRouteHandlers,
  type DailyRecommendationDemoProvider,
  type DailyRecommendationRealProvider,
} from "../../src/lib/music/recommendationsBff";
import { InMemorySessionStore } from "../../src/lib/session/sessionStore";

const dayOne = Date.UTC(2026, 6, 30, 8, 0, 0);
const user = {
  id: "9001",
  nickname: "Test Listener",
  avatarUrl: null,
  signature: null,
};
const track = {
  id: "101",
  name: "Synthetic Signal",
  artists: [{ id: "201", name: "Synthetic Artist", avatarUrl: null }],
  album: { id: "301", name: "Synthetic Album", artworkUrl: null },
  durationMs: 180_000,
  artworkUrl: null,
  aliases: [],
  explicit: false,
  availability: "unknown" as const,
  privilege: { fee: 0, maxQuality: null },
};

function createOpaqueServerValue(): string {
  return randomBytes(32).toString("base64url");
}

function cookieFor(sessionId: string): string {
  return `echoform.sid=${sessionId}`;
}

function createAuthenticatedSession(store: InMemorySessionStore): string {
  const session = store.create();
  const challenge = store.beginQrChallenge(session.id, createOpaqueServerValue());
  if (!challenge) {
    throw new Error("Expected a session challenge.");
  }
  store.authorizeQrChallenge(session.id, challenge.challengeId, createOpaqueServerValue());
  store.setAuthenticatedUser(session.id, user);
  return session.id;
}

function createHandlers(options: {
  demo?: Partial<DailyRecommendationDemoProvider>;
  now?: () => number;
  real?: Partial<DailyRecommendationRealProvider>;
  retryDelay?: (delayMs: number) => Promise<void>;
  store?: InMemorySessionStore;
  timeoutMs?: number;
} = {}) {
  const store = options.store ?? new InMemorySessionStore();
  const real: DailyRecommendationRealProvider = {
    getSessionUser: vi.fn(async () => user),
    getPersonalDailyRecommendations: vi.fn(async () => [track]),
    getPublicRecommendations: vi.fn(async () => [track]),
    ...options.real,
  };
  const demo: DailyRecommendationDemoProvider = {
    getDailyRecommendations: vi.fn(async () => [track]),
    ...options.demo,
  };
  let requestNumber = 0;
  const handlers = createDailyRecommendationRouteHandlers({
    store,
    createRealProvider: () => real,
    createDemoProvider: () => demo,
    createRequestId: () => `recommendation-request-${++requestNumber}`,
    now: options.now ?? (() => dayOne),
    random: () => 0,
    retryDelay: options.retryDelay ?? (async () => undefined),
    timeoutMs: options.timeoutMs,
  });
  return { demo, handlers, real, store };
}

async function responseBody<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

describe("daily recommendations BFF", () => {
  it("creates a Real guest session, returns public data, and caches by session and date", async () => {
    const { handlers, real } = createHandlers();
    const first = await handlers.daily(new Request("http://localhost/api/recommendations/daily"));
    const firstBody = await responseBody<{
      ok: boolean;
      data: { source: string; tracks: unknown[]; date: string };
      meta: { mode: string };
    }>(first);
    const cookie = first.headers.get("Set-Cookie")?.split(";")[0];
    if (!cookie) {
      throw new Error("Expected a session cookie.");
    }
    const second = await handlers.daily(new Request(
      "http://localhost/api/recommendations/daily",
      { headers: { cookie } },
    ));

    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    expect(firstBody).toMatchObject({
      ok: true,
      data: { source: "public", date: "2026-07-30", tracks: [{ id: "101" }] },
      meta: { mode: "real" },
    });
    expect(second.headers.get("Cache-Control")).toBe("no-store");
    expect(real.getPublicRecommendations).toHaveBeenCalledTimes(1);
  });

  it("uses a verified account only for personal daily recommendations and falls back on empty", async () => {
    const store = new InMemorySessionStore();
    const sessionId = createAuthenticatedSession(store);
    const personal = vi.fn(async () => [] as typeof track[]);
    const { handlers, real } = createHandlers({
      store,
      real: { getPersonalDailyRecommendations: personal },
    });

    const response = await handlers.daily(new Request(
      "http://localhost/api/recommendations/daily",
      { headers: { cookie: cookieFor(sessionId) } },
    ));
    const body = await responseBody<{
      data: { source: string; tracks: unknown[] };
    }>(response);

    expect(body.data).toMatchObject({ source: "public", tracks: [{ id: "101" }] });
    expect(personal).toHaveBeenCalledWith(expect.any(String));
    expect(real.getPublicRecommendations).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).not.toContain("echoform.sid");
  });

  it("does not enter Demo when a Real read fails and retries only retryable reads once", async () => {
    const store = new InMemorySessionStore();
    const session = store.create();
    const publicRead = vi.fn()
      .mockRejectedValueOnce(new AppError("NETWORK_ERROR", "offline", { retryable: true }))
      .mockRejectedValueOnce(new AppError("UPSTREAM_UNAVAILABLE", "offline", { retryable: true }));
    const { demo, handlers } = createHandlers({
      store,
      real: { getPublicRecommendations: publicRead },
    });

    const response = await handlers.daily(new Request(
      "http://localhost/api/recommendations/daily",
      { headers: { cookie: cookieFor(session.id) } },
    ));
    const body = await responseBody<{
      ok: boolean;
      error: { code: string; retryable: boolean };
    }>(response);

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "UPSTREAM_UNAVAILABLE", retryable: true },
    });
    expect(publicRead).toHaveBeenCalledTimes(2);
    expect(demo.getDailyRecommendations).not.toHaveBeenCalled();
    expect(store.getPublicState(session.id)).toEqual({ mode: "real", user: null });
  });

  it("maps a slow read to a retryable timeout without retaining a failed cache entry", async () => {
    const slowRead = vi.fn(async () => await new Promise<never>(() => undefined));
    const { handlers, real, store } = createHandlers({
      real: {
        getPublicRecommendations: slowRead,
      },
      timeoutMs: 1,
    });
    const session = store.create();
    const response = await handlers.daily(new Request(
      "http://localhost/api/recommendations/daily",
      { headers: { cookie: cookieFor(session.id) } },
    ));
    const body = await responseBody<{
      ok: boolean;
      error: { code: string; retryable: boolean };
    }>(response);

    expect(response.status).toBe(504);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "UPSTREAM_TIMEOUT", retryable: true },
    });
    expect(real.getPublicRecommendations).toHaveBeenCalledTimes(2);
    expect(store.getDailyRecommendations(session.id, `public:${session.id}:2026-07-30`))
      .toBeNull();
  });

  it("enters and exits Demo only through an explicit mode request", async () => {
    const store = new InMemorySessionStore();
    const sessionId = createAuthenticatedSession(store);
    const { demo, handlers, real } = createHandlers({ store });
    const enter = await handlers.setMode(new Request("http://localhost/api/mode", {
      method: "PUT",
      headers: {
        cookie: cookieFor(sessionId),
        "content-type": "application/json",
      },
      body: JSON.stringify({ mode: "demo" }),
    }));
    const enterBody = await responseBody<{
      ok: boolean;
      data: { mode: string; user: unknown };
      meta: { mode: string };
    }>(enter);
    const daily = await handlers.daily(new Request(
      "http://localhost/api/recommendations/daily",
      { headers: { cookie: cookieFor(sessionId) } },
    ));
    const exit = await handlers.setMode(new Request("http://localhost/api/mode", {
      method: "PUT",
      headers: {
        cookie: cookieFor(sessionId),
        "content-type": "application/json",
      },
      body: JSON.stringify({ mode: "real" }),
    }));
    const exitBody = await responseBody<{
      data: { mode: string; user: { id: string } | null };
    }>(exit);

    expect(enter.headers.get("Cache-Control")).toBe("no-store");
    expect(enterBody).toMatchObject({
      ok: true,
      data: { mode: "demo", user: null },
      meta: { mode: "demo" },
    });
    expect(await responseBody<{ data: { source: string } }>(daily)).toMatchObject({
      data: { source: "demo" },
    });
    expect(demo.getDailyRecommendations).toHaveBeenCalledTimes(1);
    expect(real.getPersonalDailyRecommendations).not.toHaveBeenCalled();
    expect(exitBody).toMatchObject({ data: { mode: "real", user: { id: "9001" } } });
  });
});
