import { describe, expect, it, vi } from "vitest";

import {
  createCatalogReadRouteHandlers,
  type CatalogReadProvider,
} from "../../src/lib/music/bff";
import { AppError } from "../../src/lib/music/errors";
import type {
  AlbumDetail,
  ArtistDetail,
  CatalogPage,
  Playlist,
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
  availability: "unknown",
  privilege: { fee: 0, maxQuality: "standard" },
};

const album: AlbumDetail = {
  album: {
    id: "301",
    name: "Synthetic Album",
    artworkUrl: null,
    artists: [{ id: "201", name: "Synthetic Artist", avatarUrl: null }],
    description: null,
    publishedAt: null,
    trackCount: 1,
  },
  tracks: [track],
};

const artist: ArtistDetail = {
  artist: {
    id: "201",
    name: "Synthetic Artist",
    avatarUrl: null,
    aliases: [],
    biography: null,
    albumCount: 1,
    trackCount: 1,
  },
  hotTracks: [track],
  albums: {
    items: [{ id: "301", name: "Synthetic Album", artworkUrl: null }],
    total: 1,
    limit: 20,
    offset: 0,
    hasMore: false,
  },
};

const playlistPage: CatalogPage<Playlist> = {
  items: [{
    id: "801",
    name: "Synthetic Playlist",
    description: null,
    artworkUrl: null,
    owner: null,
    visibility: "public",
    trackCount: 1,
    createdAt: null,
    updatedAt: null,
  }],
  total: 1,
  limit: 8,
  offset: 0,
  hasMore: false,
};

function createProvider(
  overrides: Partial<CatalogReadProvider> = {},
): CatalogReadProvider {
  return {
    getAlbum: async () => album,
    getArtist: async () => artist,
    getNewSongs: async () => [track],
    getPopularPlaylists: async () => playlistPage,
    ...overrides,
  };
}

function createHandlers(
  provider: CatalogReadProvider,
  overrides: Partial<Parameters<typeof createCatalogReadRouteHandlers>[0]> = {},
) {
  let requestNumber = 0;
  return createCatalogReadRouteHandlers({
    createProvider: () => provider,
    createRequestId: () => `catalog-request-${++requestNumber}`,
    now: () => 1_700_000_000_000,
    retryDelay: async () => undefined,
    random: () => 0,
    ...overrides,
  });
}

describe("catalog BFF read routes", () => {
  it("returns normalized catalog envelopes with a public metadata cache", async () => {
    const getAlbum = vi.fn<CatalogReadProvider["getAlbum"]>(async () => album);
    const getArtist = vi.fn<CatalogReadProvider["getArtist"]>(async () => artist);
    const getNewSongs = vi.fn<CatalogReadProvider["getNewSongs"]>(async () => [track]);
    const getPopularPlaylists = vi.fn<CatalogReadProvider["getPopularPlaylists"]>(
      async () => playlistPage,
    );
    const handlers = createHandlers(createProvider({
      getAlbum,
      getArtist,
      getNewSongs,
      getPopularPlaylists,
    }));

    const responses = await Promise.all([
      handlers.album(new Request("http://localhost/api/albums/301"), "301"),
      handlers.artist(new Request("http://localhost/api/artists/201?limit=20&offset=0"), "201"),
      handlers.newSongs(new Request("http://localhost/api/discovery/new-songs?limit=12")),
      handlers.popularPlaylists(new Request("http://localhost/api/discovery/popular-playlists?limit=8")),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe(
        "public, max-age=300, s-maxage=300",
      );
      expect(response.headers.get("X-Request-Id")).toMatch(/^catalog-request-/);
    }
    expect(getAlbum).toHaveBeenCalledWith("301");
    expect(getArtist).toHaveBeenCalledWith("201", { limit: 20, offset: 0 });
    expect(getNewSongs).toHaveBeenCalledWith(12);
    expect(getPopularPlaylists).toHaveBeenCalledWith({ limit: 8, offset: 0 });
  });

  it("validates catalog identifiers and pagination before creating a provider", async () => {
    const provider = createProvider();
    const createProviderMock = vi.fn(() => provider);
    const handlers = createCatalogReadRouteHandlers({
      createProvider: createProviderMock,
      createRequestId: () => "invalid-catalog-request",
    });

    const responses = await Promise.all([
      handlers.album(new Request("http://localhost/api/albums/not-an-id"), "not-an-id"),
      handlers.artist(new Request("http://localhost/api/artists/201?limit=0"), "201"),
      handlers.newSongs(new Request("http://localhost/api/discovery/new-songs?limit=31")),
      handlers.popularPlaylists(new Request("http://localhost/api/discovery/popular-playlists?offset=-1")),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "VALIDATION_ERROR", requestId: "invalid-catalog-request" },
      });
    }
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it("maps a missing public catalog entity to a recoverable local 404 state", async () => {
    const handlers = createHandlers(createProvider({
      getAlbum: async () => {
        throw new AppError("TRACK_UNAVAILABLE", "Synthetic missing album.");
      },
    }));

    const response = await handlers.album(
      new Request("http://localhost/api/albums/999"),
      "999",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "TRACK_UNAVAILABLE", retryable: false },
    });
  });

  it("retries a retryable discovery read once without changing its request identity", async () => {
    const getNewSongs = vi.fn<CatalogReadProvider["getNewSongs"]>()
      .mockRejectedValueOnce(new AppError("RATE_LIMITED", "Synthetic rate limit.", {
        retryable: true,
      }))
      .mockResolvedValueOnce([track]);
    const retryDelay = vi.fn(async () => undefined);
    const handlers = createHandlers(createProvider({ getNewSongs }), { retryDelay });

    const response = await handlers.newSongs(
      new Request("http://localhost/api/discovery/new-songs"),
    );

    expect(response.status).toBe(200);
    expect(getNewSongs).toHaveBeenCalledTimes(2);
    expect(retryDelay).toHaveBeenCalledWith(100);
    await expect(response.json()).resolves.toMatchObject({
      meta: { requestId: "catalog-request-1" },
    });
  });
});
