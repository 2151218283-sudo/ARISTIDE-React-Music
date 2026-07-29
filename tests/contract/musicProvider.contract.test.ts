import { describe, expect, it } from "vitest";

import { DemoMusicProvider } from "../../src/lib/music/demo";
import type { MusicProvider } from "../../src/lib/music/provider";

function useMusicProvider(provider: MusicProvider): MusicProvider {
  return provider;
}

const audioFilePattern = /(?:^|[\\/])[^?#]+\.(?:aac|flac|m4a|mp3|ogg|opus|wav)(?:[?#].*)?$/i;
const privateMediaKeys = new Set(["audioUrl", "playbackUrl", "sourceUrl", "url"]);

function containsPrivateMediaAddress(value: unknown): boolean {
  if (typeof value === "string") {
    return /^(?:blob:|data:audio\/)/i.test(value)
      || audioFilePattern.test(value);
  }

  if (Array.isArray(value)) {
    return value.some(containsPrivateMediaAddress);
  }

  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, entry]) => (
      (privateMediaKeys.has(key) && typeof entry === "string" && entry.length > 0)
      || containsPrivateMediaAddress(entry)
    ));
  }

  return false;
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

  it("contains no private media address or session data in built-in demo reads", async () => {
    const provider = new DemoMusicProvider();
    const tracks = await provider.getDailyRecommendations("demo-session");
    const lyrics = await provider.getLyrics("demo-track-001");
    const comments = await provider.getComments("demo-track-001", {
      limit: 10,
      offset: 0,
    });
    const serialized = JSON.stringify({ tracks, lyrics, comments });

    expect(containsPrivateMediaAddress({ tracks, lyrics, comments })).toBe(false);
    expect(serialized.toLocaleLowerCase()).not.toContain("cookie");
    expect(serialized.toLocaleLowerCase()).not.toContain("token");
  });

  it("detects common private media address forms without rejecting artwork", () => {
    const forbiddenSamples = [
      { sourceUrl: "https://media.example/stream" },
      { audioUrl: "/assets/demo.wav" },
      { playbackUrl: "../audio/demo.ogg" },
      { url: "data:audio/mpeg;base64,c3ludGhldGlj" },
      { url: "blob:https://example.test/synthetic-id" },
    ];

    for (const sample of forbiddenSamples) {
      expect(containsPrivateMediaAddress(sample)).toBe(true);
    }

    expect(containsPrivateMediaAddress({
      artworkUrl: "/assets/demo-cover.webp",
    })).toBe(false);
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
