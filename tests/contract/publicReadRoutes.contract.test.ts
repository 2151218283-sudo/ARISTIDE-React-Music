import { describe, expect, it, vi } from "vitest";

import {
  createPublicReadRouteHandlers,
  type PublicReadProvider,
} from "../../src/lib/music/bff";
import { AppError } from "../../src/lib/music/errors";
import type {
  CommentPage,
  LyricDocument,
  PlaybackSource,
  SearchResponse,
  Track,
} from "../../src/lib/music/models";

const track: Track = {
  id: "101",
  name: "Synthetic Signal",
  artists: [{ id: "201", name: "Synthetic Artist", avatarUrl: null }],
  album: { id: "301", name: "Synthetic Album", artworkUrl: null },
  durationMs: 180_000,
  artworkUrl: null,
  aliases: [],
  explicit: false,
  availability: "playable",
  privilege: { fee: 0, maxQuality: "lossless" },
};

const searchResponse: SearchResponse = {
  type: "track",
  items: [],
  total: 0,
  limit: 20,
  offset: 0,
  hasMore: false,
};

const lyrics: LyricDocument = {
  kind: "unavailable",
  lines: [],
};

const comments: CommentPage = {
  items: [],
  total: 0,
  limit: 20,
  offset: 0,
  hasMore: false,
};

const source: PlaybackSource = {
  url: "ephemeral-source",
  expiresAt: 1_700_000_000_000,
  quality: "standard",
  codec: null,
  bitrate: null,
  sampleRate: null,
  sizeBytes: null,
  corsMode: "unavailable",
};

function createProvider(
  overrides: Partial<PublicReadProvider> = {},
): PublicReadProvider {
  return {
    search: async () => searchResponse,
    getTrack: async () => track,
    getPlaybackSource: async () => source,
    getLyrics: async () => lyrics,
    getComments: async () => comments,
    ...overrides,
  };
}

function createHandlers(
  provider: PublicReadProvider,
  overrides: Partial<Parameters<typeof createPublicReadRouteHandlers>[0]> = {},
) {
  let requestNumber = 0;
  return createPublicReadRouteHandlers({
    createProvider: () => provider,
    createRequestId: () => `request-${++requestNumber}`,
    now: () => 1_700_000_000_000,
    retryDelay: async () => undefined,
    random: () => 0,
    ...overrides,
  });
}

async function readBody<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

describe("public BFF read routes", () => {
  it("returns the normalized success envelope, empty data, and public metadata cache", async () => {
    const search = vi.fn<PublicReadProvider["search"]>(async () => searchResponse);
    const handlers = createHandlers(createProvider({ search }));

    const response = await handlers.search(
      new Request("http://localhost/api/search?q=Signal"),
    );
    const body = await readBody<{
      ok: boolean;
      data: SearchResponse;
      meta: { requestId: string; mode: string; fetchedAt: string };
    }>(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=300, s-maxage=300",
    );
    expect(response.headers.get("X-Request-Id")).toBe("request-1");
    expect(body).toMatchObject({
      ok: true,
      data: { items: [] },
      meta: {
        requestId: "request-1",
        mode: "real",
        fetchedAt: "2023-11-14T22:13:20.000Z",
      },
    });
    expect(search).toHaveBeenCalledWith({
      text: "Signal",
      type: "all",
      limit: 20,
      offset: 0,
    });
  });

  it("rejects invalid query, paging, quality, and track identifiers before a provider call", async () => {
    const provider = createProvider();
    const createProviderMock = vi.fn(() => provider);
    const handlers = createPublicReadRouteHandlers({
      createProvider: createProviderMock,
      createRequestId: () => "invalid-input-request",
    });

    const searchResponse = await handlers.search(
      new Request("http://localhost/api/search?q=&limit=31"),
    );
    const sourceResponse = await handlers.source(
      new Request("http://localhost/api/tracks/101/source?quality=unknown"),
      "101",
    );
    const commentsResponse = await handlers.comments(
      new Request("http://localhost/api/tracks/not-an-id/comments?offset=-1"),
      "not-an-id",
    );

    for (const response of [searchResponse, sourceResponse, commentsResponse]) {
      const body = await readBody<{
        ok: boolean;
        error: { code: string; requestId: string };
      }>(response);
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(body).toMatchObject({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          requestId: "invalid-input-request",
        },
      });
    }
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it("retries a rate-limited read once and keeps the same request identity", async () => {
    const search = vi.fn<PublicReadProvider["search"]>()
      .mockRejectedValueOnce(new AppError(
        "RATE_LIMITED",
        "请求过于频繁，请稍后重试。",
        { retryable: true },
      ))
      .mockResolvedValueOnce(searchResponse);
    const retryDelay = vi.fn(async () => undefined);
    const handlers = createHandlers(createProvider({ search }), { retryDelay });

    const response = await handlers.search(
      new Request("http://localhost/api/search?q=Signal&type=track"),
    );
    const body = await readBody<{
      ok: boolean;
      meta: { requestId: string };
    }>(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, meta: { requestId: "request-1" } });
    expect(search).toHaveBeenCalledTimes(2);
    expect(retryDelay).toHaveBeenCalledWith(100);
  });

  it("maps two timed-out attempts to a retryable 504 response", async () => {
    const getTrack = vi.fn<PublicReadProvider["getTrack"]>(
      async () => await new Promise<Track>(() => undefined),
    );
    const handlers = createHandlers(createProvider({ getTrack }), {
      timeoutMs: { default: 1, source: 1 },
    });

    const response = await handlers.track(
      new Request("http://localhost/api/tracks/101"),
      "101",
    );
    const body = await readBody<{
      ok: boolean;
      error: { code: string; retryable: boolean; requestId: string };
    }>(response);

    expect(response.status).toBe(504);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      ok: false,
      error: {
        code: "UPSTREAM_TIMEOUT",
        message: "上游响应超时，请稍后重试。",
        retryable: true,
        requestId: "request-1",
      },
    });
    expect(getTrack).toHaveBeenCalledTimes(2);
  });

  it("maps an unknown thrown error to 500 without exposing sensitive fragments", async () => {
    const getLyrics = vi.fn<PublicReadProvider["getLyrics"]>(async () => {
      throw new Error(
        "raw-upstream-body=never-public; upstream-cookie=never-public; qr-key=never-public; source-url=never-public",
      );
    });
    const handlers = createHandlers(createProvider({ getLyrics }));

    const response = await handlers.lyrics(
      new Request("http://localhost/api/tracks/101/lyrics"),
      "101",
    );
    const text = await response.text();
    const body = JSON.parse(text) as {
      ok: boolean;
      error: { code: string; requestId: string };
    };

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "UNKNOWN_ERROR", requestId: "request-1" },
    });
    expect(text).not.toContain("raw-upstream-body=never-public");
    expect(text).not.toContain("upstream-cookie=never-public");
    expect(text).not.toContain("qr-key=never-public");
    expect(text).not.toContain("source-url=never-public");
  });

  it("maps a safe upstream-unavailable provider error to 502 without retrying it", async () => {
    const getLyrics = vi.fn<PublicReadProvider["getLyrics"]>(async () => {
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        "网易云服务暂时不可用。",
        { retryable: true },
      );
    });
    const handlers = createHandlers(createProvider({ getLyrics }));

    const response = await handlers.lyrics(
      new Request("http://localhost/api/tracks/101/lyrics"),
      "101",
    );
    const body = await readBody<{
      ok: boolean;
      error: { code: string; retryable: boolean; requestId: string };
    }>(response);

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        retryable: true,
        requestId: "request-1",
      },
    });
    expect(getLyrics).toHaveBeenCalledTimes(1);
  });

  it("preserves an all-search partial success and its partial errors", async () => {
    const allResult: SearchResponse = {
      type: "all",
      tracks: { items: [track], total: 1, hasMore: false },
      artists: { items: [], total: null, hasMore: false },
      albums: { items: [], total: null, hasMore: false },
      partialErrors: [{
        type: "artist",
        code: "UPSTREAM_UNAVAILABLE",
        retryable: true,
      }],
    };
    const handlers = createHandlers(createProvider({
      search: async () => allResult,
    }));

    const response = await handlers.search(
      new Request("http://localhost/api/search?q=Signal&type=all"),
    );
    const body = await readBody<{
      ok: boolean;
      data: SearchResponse;
    }>(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        type: "all",
        tracks: { items: [{ id: "101" }] },
        partialErrors: [{ type: "artist", code: "UPSTREAM_UNAVAILABLE" }],
      },
    });
  });

  it("uses no-store for a playable source and maps an unavailable source to 409", async () => {
    const getPlaybackSource = vi.fn<PublicReadProvider["getPlaybackSource"]>()
      .mockResolvedValueOnce(source)
      .mockRejectedValueOnce(new AppError(
        "TRACK_UNAVAILABLE",
        "当前歌曲暂时不可播放。",
        { details: { trackId: "101" } },
      ));
    const handlers = createHandlers(createProvider({ getPlaybackSource }));

    const playable = await handlers.source(
      new Request("http://localhost/api/tracks/101/source"),
      "101",
    );
    const unavailable = await handlers.source(
      new Request("http://localhost/api/tracks/101/source"),
      "101",
    );
    const unavailableBody = await readBody<{
      ok: boolean;
      error: { code: string; details?: { trackId: string }; requestId: string };
    }>(unavailable);

    expect(playable.status).toBe(200);
    expect(playable.headers.get("Cache-Control")).toBe("no-store");
    expect(unavailable.status).toBe(409);
    expect(unavailable.headers.get("Cache-Control")).toBe("no-store");
    expect(unavailableBody).toMatchObject({
      ok: false,
      error: {
        code: "TRACK_UNAVAILABLE",
        details: { trackId: "101" },
        requestId: "request-2",
      },
    });
    expect(getPlaybackSource).toHaveBeenNthCalledWith(1, "101", "standard");
  });

  it("applies the comment cache and forwards validated pagination", async () => {
    const getComments = vi.fn<PublicReadProvider["getComments"]>(async () => comments);
    const handlers = createHandlers(createProvider({ getComments }));

    const response = await handlers.comments(
      new Request("http://localhost/api/tracks/101/comments?limit=40&offset=80"),
      "101",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=30, s-maxage=30",
    );
    expect(getComments).toHaveBeenCalledWith("101", { limit: 40, offset: 80 });
  });
});
