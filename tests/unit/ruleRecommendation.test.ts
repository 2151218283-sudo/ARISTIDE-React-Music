import { describe, expect, it } from "vitest";

import {
  buildTasteProfile,
  limitRecommendedArtists,
  rankSimilarTracks,
  selectRuleSeeds,
} from "../../src/lib/music/ruleRecommendation";
import type { Track } from "../../src/lib/music/models";

function track(id: string, artistId: string): Track {
  return {
    id, name: id,
    artists: [{ id: artistId, name: artistId, avatarUrl: null }],
    album: { id: `album-${id}`, name: id, artworkUrl: null },
    durationMs: 180_000, artworkUrl: null, aliases: [], explicit: false,
    availability: "unknown", privilege: { fee: 0, maxQuality: "standard" },
  };
}

describe("deterministic rule recommendation", () => {
  it("selects at most ten unique seeds and remains stable for the same user and date", () => {
    const history = Array.from({ length: 8 }, (_, index) => ({
      trackId: String(index + 1), playedAt: 100 - index,
    }));
    const likes = Array.from({ length: 20 }, (_, index) => String(index + 5));
    const first = selectRuleSeeds(history, likes, "2026-10-05", "9001");
    expect(first).toEqual(selectRuleSeeds(history, likes, "2026-10-05", "9001"));
    expect(first).toHaveLength(10);
    expect(new Set(first.map((seed) => seed.trackId)).size).toBe(10);
    expect(first.slice(0, 5).map((seed) => seed.trackId)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("sums multiple real seed hits and excludes known tracks", () => {
    const ranked = rankSimilarTracks([
      { seed: { trackId: "1", source: "local-history" }, seedName: "History", tracks: [track("10", "a"), track("11", "a")] },
      { seed: { trackId: "2", source: "liked" }, seedName: "Liked", tracks: [track("11", "a"), track("12", "b")] },
    ], new Set(["10"]));
    expect(ranked.map((item) => item.track.id)).toEqual(["11", "12"]);
    expect(ranked[0]).toMatchObject({ score: 97, reasons: [{ seedId: "1" }, { seedId: "2" }] });
  });

  it("caps every credited artist at two tracks", () => {
    const items = [track("1", "a"), track("2", "a"), track("3", "a"), track("4", "b")]
      .map((candidate) => ({ track: candidate, score: 1, reasons: [] }));
    expect(limitRecommendedArtists(items).map((item) => item.track.id)).toEqual(["1", "2", "4"]);
  });

  it("counts unique sample tracks by their actual primary artist", () => {
    const samples = [track("1", "a"), track("2", "a"), track("3", "b"), track("4", "c"), track("5", "c"), track("1", "a")];
    expect(buildTasteProfile(samples)).toMatchObject({
      sampleSize: 5,
      categories: [{ artistId: "a", tracks: 2, share: 40 }, { artistId: "c", tracks: 2, share: 40 }, { artistId: "b", tracks: 1, share: 20 }],
    });
    expect(buildTasteProfile(samples.slice(0, 4))).toBeNull();
  });
});
