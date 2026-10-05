import type {
  LocalHistorySeed,
  RuleRecommendationItem,
  RuleRecommendationReason,
  Track,
} from "./models";

export interface RuleSeed {
  trackId: string;
  source: "liked" | "local-history";
}

export interface SimilarSeedResult {
  seed: RuleSeed;
  seedName: string;
  tracks: Track[];
}

export interface TasteCategory {
  artistId: string;
  name: string;
  tracks: number;
  share: number;
}

export interface TasteProfile {
  sampleSize: number;
  categories: TasteCategory[];
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function selectRuleSeeds(
  history: readonly LocalHistorySeed[],
  likedIds: readonly string[],
  date: string,
  userId: string,
): RuleSeed[] {
  const recent = [...history]
    .sort((left, right) => right.playedAt - left.playedAt || left.trackId.localeCompare(right.trackId))
    .map((entry) => entry.trackId);
  const liked = [...new Set(likedIds)].sort((left, right) => (
    stableHash(`${date}:${userId}:${left}`) - stableHash(`${date}:${userId}:${right}`)
    || left.localeCompare(right)
  ));
  const selected: RuleSeed[] = [];
  const seen = new Set<string>();
  const add = (ids: readonly string[], source: RuleSeed["source"], limit: number): void => {
    for (const trackId of ids) {
      if (selected.length >= limit) break;
      if (!seen.has(trackId)) {
        seen.add(trackId);
        selected.push({ trackId, source });
      }
    }
  };
  add(recent, "local-history", 5);
  add(liked, "liked", selected.length + 5);
  add(recent, "local-history", 10);
  add(liked, "liked", 10);
  return selected;
}

export function rankSimilarTracks(
  groups: readonly SimilarSeedResult[],
  excludedIds: ReadonlySet<string>,
): RuleRecommendationItem[] {
  const candidates = new Map<string, RuleRecommendationItem>();
  for (const { seed, seedName, tracks } of groups) {
    tracks.slice(0, 20).forEach((track, index) => {
      if (excludedIds.has(track.id)) return;
      const reason: RuleRecommendationReason = {
        seedId: seed.trackId,
        seedName,
        source: seed.source,
      };
      const contribution = (seed.source === "local-history" ? 3 : 2) * (20 - index);
      const previous = candidates.get(track.id);
      if (previous) {
        if (!previous.reasons.some((item) => item.seedId === seed.trackId)) {
          previous.score += contribution;
          previous.reasons.push(reason);
        }
      } else {
        candidates.set(track.id, { track, score: contribution, reasons: [reason] });
      }
    });
  }
  return [...candidates.values()].sort((left, right) => (
    right.score - left.score || left.track.id.localeCompare(right.track.id)
  ));
}

export function limitRecommendedArtists(
  items: readonly RuleRecommendationItem[],
  limit = 12,
): RuleRecommendationItem[] {
  const artistCounts = new Map<string, number>();
  const selected: RuleRecommendationItem[] = [];
  for (const item of items) {
    const artists = [...new Set(item.track.artists.map((artist) => artist.id))];
    if (artists.some((id) => (artistCounts.get(id) ?? 0) >= 2)) continue;
    selected.push(item);
    artists.forEach((id) => artistCounts.set(id, (artistCounts.get(id) ?? 0) + 1));
    if (selected.length >= limit) break;
  }
  return selected;
}

export function buildTasteProfile(tracks: readonly Track[]): TasteProfile | null {
  const unique = new Map(tracks.map((track) => [track.id, track]));
  const counts = new Map<string, { name: string; tracks: number }>();
  for (const track of unique.values()) {
    const artist = track.artists[0];
    if (!artist?.id || !artist.name) continue;
    const previous = counts.get(artist.id);
    counts.set(artist.id, { name: artist.name, tracks: (previous?.tracks ?? 0) + 1 });
  }
  const sampleSize = [...counts.values()].reduce((sum, item) => sum + item.tracks, 0);
  if (sampleSize < 5 || counts.size < 3) return null;
  const categories = [...counts.entries()]
    .map(([artistId, value]) => ({
      artistId,
      name: value.name,
      tracks: value.tracks,
      share: Math.round((value.tracks / sampleSize) * 100),
    }))
    .sort((left, right) => right.tracks - left.tracks || left.artistId.localeCompare(right.artistId))
    .slice(0, 5);
  return { sampleSize, categories };
}
