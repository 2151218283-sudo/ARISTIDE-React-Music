import { describe, expect, it } from "vitest";

import { DemoMusicProvider } from "../../src/lib/music/demo";
import type { MusicProvider } from "../../src/lib/music/provider";

function useMusicProvider(provider: MusicProvider): MusicProvider {
  return provider;
}

describe("DemoMusicProvider contract", () => {
  it("returns normalized track, lyric, comment, and search shapes", async () => {
    const provider = useMusicProvider(new DemoMusicProvider({ seed: "contract" }));
    const track = await provider.getTrack("demo-track-001");
    const lyrics = await provider.getLyrics(track.id);
    const comments = await provider.getComments(track.id, { limit: 10, offset: 0 });
    const search = await provider.search({
      text: "quiet",
      type: "all",
      limit: 20,
      offset: 0,
    });

    expect(track).toMatchObject({
      id: "demo-track-001",
      artworkUrl: null,
      availability: "unknown",
      privilege: { fee: 0 },
    });
    expect(lyrics).toMatchObject({ kind: "synced" });
    expect(comments).toMatchObject({
      limit: 10,
      offset: 0,
      total: 1,
      hasMore: false,
    });
    expect(search).toMatchObject({
      type: "all",
      partialErrors: [],
    });

    for (const upstreamField of ["ar", "al", "dt", "picUrl", "song"]) {
      expect(track).not.toHaveProperty(upstreamField);
    }
  });

  it("contains no media URL or private session data in built-in demo reads", async () => {
    const provider = new DemoMusicProvider();
    const tracks = await provider.getDailyRecommendations("demo-session");
    const lyrics = await provider.getLyrics("demo-track-001");
    const comments = await provider.getComments("demo-track-001", {
      limit: 10,
      offset: 0,
    });
    const serialized = JSON.stringify({ tracks, lyrics, comments });

    expect(serialized).not.toContain("://");
    expect(serialized).not.toContain(".mp3");
    expect(serialized.toLocaleLowerCase()).not.toContain("cookie");
    expect(serialized.toLocaleLowerCase()).not.toContain("token");
  });

  it("does not fabricate QR authorization, a session user, or writes", async () => {
    const provider = new DemoMusicProvider();

    await expect(provider.getSessionUser("demo-session")).resolves.toBeNull();
    await expect(provider.startQrLogin("demo-session")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
    await expect(provider.createPlaylist({
      name: "Local test playlist",
      visibility: "private",
      clientMutationId: "mutation-001",
    }, "demo-session")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("returns a stable error instead of constructing an empty playback source", async () => {
    const provider = new DemoMusicProvider();

    await expect(
      provider.getPlaybackSource("demo-track-001", "standard"),
    ).rejects.toMatchObject({
      code: "TRACK_UNAVAILABLE",
      details: { trackId: "demo-track-001" },
    });
  });
});
