import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/lib/music/errors";
import {
  createLibraryWriteRouteHandlers,
  type LibraryWriteProvider,
} from "../../src/lib/music/libraryWriteBff";
import type { AlbumSummary, Track } from "../../src/lib/music/models";
import { InMemorySessionStore, SESSION_COOKIE_NAME } from "../../src/lib/session/sessionStore";

const track: Track = {
  id: "101",
  name: "Synthetic Signal",
  artists: [{ id: "201", name: "Synthetic Artist", avatarUrl: null }],
  album: { id: "301", name: "Synthetic Album", artworkUrl: null },
  durationMs: 180_000,
  artworkUrl: null,
  aliases: [],
  explicit: false,
  availability: "unknown",
  privilege: { fee: 0, maxQuality: null },
};

const album: AlbumSummary = {
  id: "301",
  name: "Synthetic Album",
  artworkUrl: null,
};

function provider(): LibraryWriteProvider & {
  setTrackLiked: ReturnType<typeof vi.fn>;
  setAlbumCollected: ReturnType<typeof vi.fn>;
} {
  return {
    getLikedTracks: vi.fn(async () => ({
      items: [track],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
    })),
    getSavedAlbums: vi.fn(async () => ({
      items: [album],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
    })),
    setTrackLiked: vi.fn(async () => {}),
    setAlbumCollected: vi.fn(async () => {}),
  };
}

function request(path: string, init: RequestInit = {}, cookie?: string): Request {
  return new Request(`https://echoform.test${path}`, {
    ...init,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
  });
}

function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE_NAME}=${sessionId}`;
}

function authenticatedHandlers() {
  const store = new InMemorySessionStore();
  const session = store.create();
  session.user = {
    id: "701",
    nickname: "Synthetic User",
    avatarUrl: null,
    signature: null,
  };
  session.upstreamCookie = "server-only-cookie";
  const real = provider();
  const demo = provider();
  return {
    handlers: createLibraryWriteRouteHandlers({
      createDemoProvider: () => demo,
      createRealProvider: () => real,
      store,
    }),
    real,
    session,
  };
}

describe("library write route contract", () => {
  it("requires a Session and never accepts a client upstream Cookie", async () => {
    const { handlers, real } = authenticatedHandlers();
    const response = await handlers.like(request(
      "/api/library/likes/101",
      {
        body: JSON.stringify({ clientMutationId: "mutation-guest-0001" }),
        method: "PUT",
      },
    ), "101", true);

    expect(response.status).toBe(401);
    expect(real.setTrackLiked).not.toHaveBeenCalled();
  });

  it("returns the first success for a repeated mutation ID without another upstream call", async () => {
    const { handlers, real, session } = authenticatedHandlers();
    const cookie = sessionCookie(session.id);
    const init = {
      body: JSON.stringify({ clientMutationId: "mutation-track-0000001" }),
      method: "PUT",
    } as const;
    const first = await handlers.like(request("/api/library/likes/101", init, cookie), "101", true);
    const second = await handlers.like(request("/api/library/likes/101", init, cookie), "101", true);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, data: {
      kind: "track-like", id: "101", active: true,
    } });
    expect(await second.json()).toMatchObject({ ok: true, data: {
      kind: "track-like", id: "101", active: true,
    } });
    expect(real.setTrackLiked).toHaveBeenCalledTimes(1);
  });

  it("rejects reusing one mutation ID for a different operation", async () => {
    const { handlers, session } = authenticatedHandlers();
    const cookie = sessionCookie(session.id);
    const body = JSON.stringify({ clientMutationId: "mutation-reuse-00001" });
    const first = await handlers.like(request("/api/library/likes/101", { body, method: "PUT" }, cookie), "101", true);
    const second = await handlers.like(request("/api/library/likes/101", { body, method: "DELETE" }, cookie), "101", false);

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect(await second.json()).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("does not retry a failed write and keeps the normalized failure envelope", async () => {
    const { handlers, real, session } = authenticatedHandlers();
    real.setTrackLiked.mockRejectedValueOnce(new AppError(
      "UPSTREAM_UNAVAILABLE",
      "网易云喜欢操作未完成。",
      { retryable: true },
    ));
    const response = await handlers.like(request(
      "/api/library/likes/101",
      {
        body: JSON.stringify({ clientMutationId: "mutation-fail-0000001" }),
        method: "PUT",
      },
      sessionCookie(session.id),
    ), "101", true);

    expect(response.status).toBe(502);
    expect(real.setTrackLiked).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "UPSTREAM_UNAVAILABLE", message: "网易云喜欢操作未完成。" },
    });
  });

  it("serves likes and albums as no-store normalized pages", async () => {
    const { handlers, real, session } = authenticatedHandlers();
    const cookie = sessionCookie(session.id);
    const likes = await handlers.likes(request("/api/library/likes", {}, cookie));
    const albums = await handlers.albums(request("/api/library/albums", {}, cookie));

    expect(likes.status).toBe(200);
    expect(likes.headers.get("Cache-Control")).toBe("no-store");
    expect(await likes.json()).toMatchObject({ ok: true, data: { items: [{ id: "101" }] } });
    expect(await albums.json()).toMatchObject({ ok: true, data: { items: [{ id: "301" }] } });
    expect(real.getLikedTracks).toHaveBeenCalledWith("701", { limit: 50, offset: 0 }, "server-only-cookie");
  });

  it("allows explicit Demo mode without presenting it as a real account", async () => {
    const store = new InMemorySessionStore();
    const session = store.create();
    session.mode = "demo";
    const demo = provider();
    const handlers = createLibraryWriteRouteHandlers({
      createDemoProvider: () => demo,
      createRealProvider: provider,
      store,
    });

    const response = await handlers.album(request(
      "/api/library/albums/301",
      {
        body: JSON.stringify({ clientMutationId: "mutation-demo-000001" }),
        method: "PUT",
      },
      sessionCookie(session.id),
    ), "301", true);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: {
      kind: "album-collection", id: "301", active: true,
    }, meta: { mode: "demo" } });
    expect(demo.setAlbumCollected).toHaveBeenCalledWith("301", true, session.id);
  });

  it("accepts deterministic Demo fixture IDs while keeping Real IDs constrained", async () => {
    const store = new InMemorySessionStore();
    const session = store.create();
    session.mode = "demo";
    const demo = provider();
    const handlers = createLibraryWriteRouteHandlers({
      createDemoProvider: () => demo,
      createRealProvider: provider,
      store,
    });

    const response = await handlers.like(request(
      "/api/library/likes/demo-track-001",
      {
        body: JSON.stringify({ clientMutationId: "mutation-demo-track-0001" }),
        method: "PUT",
      },
      sessionCookie(session.id),
    ), "demo-track-001", true);

    expect(response.status).toBe(200);
    expect(demo.setTrackLiked).toHaveBeenCalledWith("demo-track-001", true, session.id);
  });
});
