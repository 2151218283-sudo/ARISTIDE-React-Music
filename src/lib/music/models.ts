import type { AppErrorCode } from "./errors";

export type DataMode = "real" | "demo";

export type AudioQuality =
  | "standard"
  | "exhigh"
  | "lossless"
  | "hires";

export type TrackAvailability =
  | "playable"
  | "vip"
  | "copyright"
  | "region"
  | "unknown";

export interface ArtistSummary {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface Artist extends ArtistSummary {
  aliases: string[];
  biography: string | null;
  albumCount: number | null;
  trackCount: number | null;
}

export interface AlbumSummary {
  id: string;
  name: string;
  artworkUrl: string | null;
}

export interface Album extends AlbumSummary {
  artists: ArtistSummary[];
  description: string | null;
  publishedAt: number | null;
  trackCount: number;
}

export interface TrackPrivilege {
  fee: number | null;
  maxQuality: AudioQuality | null;
}

export interface Track {
  id: string;
  name: string;
  artists: ArtistSummary[];
  album: AlbumSummary;
  durationMs: number;
  artworkUrl: string | null;
  aliases: string[];
  explicit: boolean;
  availability: TrackAvailability;
  privilege: TrackPrivilege;
}

export type DailyRecommendationSource = "personal" | "public" | "demo";

export interface DailyRecommendations {
  date: string;
  source: DailyRecommendationSource;
  tracks: Track[];
}

export interface UserProfile {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  signature: string | null;
}

export type PlaylistVisibility = "public" | "private";

export interface Playlist {
  id: string;
  name: string;
  description: string | null;
  artworkUrl: string | null;
  owner: UserProfile | null;
  visibility: PlaylistVisibility;
  trackCount: number;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface CommentReplySummary {
  id: string;
  nickname: string;
}

export interface Comment {
  id: string;
  author: UserProfile;
  content: string;
  createdAt: number;
  likedCount: number;
  likedByCurrentUser: boolean;
  replyTo: CommentReplySummary | null;
}

export interface LyricWord {
  startMs: number;
  durationMs: number;
  text: string;
}

export interface LyricLine {
  startMs: number;
  durationMs: number | null;
  text: string;
  translation: string | null;
  romanization: string | null;
  words: LyricWord[] | null;
}

export type LyricKind =
  | "synced"
  | "plain"
  | "instrumental"
  | "unavailable";

export interface LyricDocument {
  kind: LyricKind;
  lines: LyricLine[];
}

export type Lyrics = LyricDocument;

export interface PlaybackSource {
  url: string;
  expiresAt: number;
  quality: AudioQuality;
  codec: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  sizeBytes: number | null;
  corsMode: "anonymous" | "unavailable";
}

export type PlaybackAvailabilityState = "verified-playable" | "unavailable";

export interface PlaybackAvailability {
  state: PlaybackAvailabilityState;
}

export interface PageQuery {
  limit: number;
  offset: number;
}

export interface CommentPage extends PageQuery {
  items: Comment[];
  total: number | null;
  hasMore: boolean;
}

export type SearchKind = "track" | "album" | "artist";
export type SearchType = SearchKind | "all";

export interface SearchQuery extends PageQuery {
  text: string;
  type: SearchType;
}

export interface SearchPage<T, K extends SearchKind> extends PageQuery {
  type: K;
  items: T[];
  total: number | null;
  hasMore: boolean;
}

export interface SearchSection<T> {
  items: T[];
  total: number | null;
  hasMore: boolean;
}

export interface SearchPartialError {
  type: SearchKind;
  code: AppErrorCode;
  retryable: boolean;
}

export interface SearchAllResult {
  type: "all";
  tracks: SearchSection<Track>;
  artists: SearchSection<ArtistSummary>;
  albums: SearchSection<AlbumSummary>;
  partialErrors: SearchPartialError[];
}

export type SearchResponse =
  | SearchPage<Track, "track">
  | SearchPage<AlbumSummary, "album">
  | SearchPage<ArtistSummary, "artist">
  | SearchAllResult;

export interface QrChallenge {
  challengeId: string;
  imageDataUrl: string;
  expiresAt: number;
}

export type QrLoginState =
  | { status: "waiting"; expiresAt: number }
  | { status: "scanned"; expiresAt: number }
  | { status: "authorized"; user: UserProfile }
  | { status: "expired" };

export interface CreatePlaylistInput {
  name: string;
  description?: string;
  visibility: PlaylistVisibility;
  clientMutationId: string;
}

export interface ChangePlaylistTracksInput {
  playlistId: string;
  trackIds: string[];
  operation: "add" | "remove";
  clientMutationId: string;
}

export interface CreateCommentInput {
  trackId: string;
  content: string;
  replyToCommentId?: string;
  clientMutationId: string;
}
