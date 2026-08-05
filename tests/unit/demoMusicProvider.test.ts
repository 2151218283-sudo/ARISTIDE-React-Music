import { describe, expect, it } from "vitest";

import { DemoMusicProvider } from "../../src/lib/music/demo";

const page = { limit: 20, offset: 0 };

describe("DemoMusicProvider scenarios", () => {
  it("returns the same isolated recommendation order for the same seed", async () => {
    const firstProvider = new DemoMusicProvider({ seed: "stable-seed" });
    const secondProvider = new DemoMusicProvider({ seed: "stable-seed" });
    const first = await firstProvider.getDailyRecommendations("session-a");
    const second = await secondProvider.getDailyRecommendations("session-b");

    expect(first.map((track) => track.id)).toEqual(second.map((track) => track.id));

    first[0].name = "mutated by caller";
    const fresh = await firstProvider.getDailyRecommendations("session-a");
    expect(fresh[0].name).not.toBe("mutated by caller");
  });

  it("returns deterministic empty data", async () => {
    const provider = new DemoMusicProvider({ scenario: "empty" });

    await expect(provider.getDailyRecommendations("session")).resolves.toEqual([]);
    await expect(provider.search({
      text: "quiet",
      type: "track",
      ...page,
    })).resolves.toMatchObject({
      type: "track",
      items: [],
      total: 0,
      hasMore: false,
    });
    await expect(provider.getNewSongs(12)).resolves.toEqual([]);
    await expect(provider.getPopularPlaylists({ limit: 8, offset: 0 })).resolves.toMatchObject({
      items: [],
      total: 0,
      hasMore: false,
    });
  });

  it("returns normalized demo catalog details and bounded discovery data", async () => {
    const provider = new DemoMusicProvider({ seed: "catalog-seed" });

    const album = await provider.getAlbum("demo-album-001");
    const artist = await provider.getArtist("demo-artist-001", page);
    const newSongs = await provider.getNewSongs(2);
    const playlists = await provider.getPopularPlaylists({ limit: 2, offset: 0 });

    expect(album).toMatchObject({
      album: { id: "demo-album-001", trackCount: 1 },
      tracks: [{ id: "demo-track-001" }],
    });
    expect(artist).toMatchObject({
      artist: { id: "demo-artist-001", albumCount: 2 },
      hotTracks: [{ id: "demo-track-001" }, { id: "demo-track-004" }],
      albums: {
        items: [{ id: "demo-album-001" }, { id: "demo-album-004" }],
        hasMore: false,
      },
    });
    expect(newSongs).toHaveLength(2);
    expect(playlists).toMatchObject({ limit: 2, offset: 0 });
    expect(playlists.items[0]).toMatchObject({ id: "demo-playlist-1" });
  });

  it("maps the timeout scenario to a retryable AppError", async () => {
    const provider = new DemoMusicProvider({ scenario: "timeout" });

    await expect(provider.getDailyRecommendations("session")).rejects.toMatchObject({
      code: "UPSTREAM_TIMEOUT",
      retryable: true,
    });
  });

  it("maps the upstream error scenario to a retryable AppError", async () => {
    const provider = new DemoMusicProvider({ scenario: "upstream-error" });

    await expect(provider.getDailyRecommendations("session")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
    });
  });

  it("marks the unplayable scenario and rejects its playback source", async () => {
    const provider = new DemoMusicProvider({ scenario: "unplayable" });
    const tracks = await provider.getDailyRecommendations("session");

    expect(tracks.every((track) => track.availability === "copyright")).toBe(true);
    await expect(
      provider.getPlaybackSource(tracks[0].id, "standard"),
    ).rejects.toMatchObject({
      code: "TRACK_UNAVAILABLE",
      retryable: false,
    });
  });

  it("returns an explicit unavailable lyric document", async () => {
    const provider = new DemoMusicProvider({ scenario: "no-lyrics" });

    await expect(provider.getLyrics("demo-track-001")).resolves.toEqual({
      kind: "unavailable",
      lines: [],
    });
  });

  it("returns an explicit empty comment page", async () => {
    const provider = new DemoMusicProvider({ scenario: "no-comments" });

    await expect(provider.getComments("demo-track-001", page)).resolves.toEqual({
      ...page,
      items: [],
      total: 0,
      hasMore: false,
    });
  });

  it("rejects invalid pagination before returning data", async () => {
    const provider = new DemoMusicProvider();

    await expect(provider.getComments("demo-track-001", {
      limit: 0,
      offset: -1,
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
