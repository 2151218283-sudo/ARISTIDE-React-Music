import { AppError } from "../errors";
import { parseLyrics } from "../lyricParser";
import type {
  Album,
  AlbumDetail,
  AlbumSummary,
  Artist,
  ArtistDetail,
  ArtistSummary,
  AudioQuality,
  CatalogPage,
  Comment,
  CommentPage,
  LyricDocument,
  PlaybackSource,
  Playlist,
  SearchKind,
  SearchPage,
  Track,
  UserProfile,
  UserPlaylistCollection,
} from "../models";
import type {
  LegacyApiResponse,
  LegacyQrChallenge,
  LegacyQrPollResult,
} from "./types";

type UnknownRecord = Record<string, unknown>;

const audioQualities: readonly AudioQuality[] = [
  "standard",
  "exhigh",
  "lossless",
  "hires",
];

function upstreamError(message = "网易云服务返回了无法识别的数据。") {
  return new AppError("UPSTREAM_UNAVAILABLE", message, { retryable: true });
}

export function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function entityId(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return null;
}

function publicMediaUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) {
    return null;
  }
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? candidate
      : null;
  } catch {
    return null;
  }
}

function playbackUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) {
    return null;
  }
  try {
    const protocol = new URL(candidate).protocol;
    return protocol === "https:" || protocol === "http:" ? candidate : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
      const normalized = text(entry);
      return normalized ? [normalized] : [];
    })
    : [];
}

function childRecord(parent: UnknownRecord, ...keys: string[]): UnknownRecord | null {
  for (const key of keys) {
    const value = asRecord(parent[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function childArray(parent: UnknownRecord, ...keys: string[]): unknown[] | null {
  for (const key of keys) {
    const value = parent[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function quality(value: unknown): AudioQuality | null {
  return typeof value === "string" && audioQualities.includes(value as AudioQuality)
    ? value as AudioQuality
    : null;
}

export function mapArtist(value: unknown): ArtistSummary | null {
  const artist = asRecord(value);
  const id = artist ? entityId(artist.id) : null;
  const name = artist ? text(artist.name) : null;
  if (!artist || !id || !name) {
    return null;
  }
  return {
    id,
    name,
    avatarUrl: publicMediaUrl(artist.picUrl ?? artist.img1v1Url ?? artist.cover),
  };
}

export function mapAlbum(value: unknown): AlbumSummary | null {
  const album = asRecord(value);
  const id = album ? entityId(album.id) : null;
  const name = album ? text(album.name) : null;
  if (!album || !id || !name) {
    return null;
  }
  return {
    id,
    name,
    artworkUrl: publicMediaUrl(album.picUrl ?? album.blurPicUrl),
  };
}

function mapUser(value: unknown): UserProfile | null {
  const user = asRecord(value);
  const id = user ? entityId(user.userId ?? user.id) : null;
  const nickname = user ? text(user.nickname) : null;
  if (!user || !id || !nickname) {
    return null;
  }
  return {
    id,
    nickname,
    avatarUrl: publicMediaUrl(user.avatarUrl),
    signature: text(user.signature),
  };
}

function privilegeForTrack(
  track: UnknownRecord,
  privilege: UnknownRecord | null,
): Track["privilege"] {
  const fee = nonNegativeNumber(privilege?.fee ?? track.fee);
  const maxQuality = quality(
    privilege?.playMaxLevel
      ?? privilege?.maxLevel
      ?? track.playMaxLevel,
  );
  return { fee, maxQuality };
}

function mapTrack(
  value: unknown,
  privilege: UnknownRecord | null = null,
): Track | null {
  const track = asRecord(value);
  const id = track ? entityId(track.id) : null;
  const name = track ? text(track.name) : null;
  const album = track ? mapAlbum(track.al ?? track.album) : null;
  if (!track || !id || !name || !album) {
    return null;
  }

  const rawArtists = childArray(track, "ar", "artists") ?? [];
  const artists = rawArtists.flatMap((artist) => {
    const normalized = mapArtist(artist);
    return normalized ? [normalized] : [];
  });
  const durationMs = nonNegativeNumber(track.dt ?? track.duration) ?? 0;

  return {
    id,
    name,
    artists,
    album,
    durationMs,
    artworkUrl: album.artworkUrl,
    aliases: stringArray(track.alia ?? track.alias),
    explicit: track.explicit === true,
    availability: "unknown",
    privilege: privilegeForTrack(track, privilege),
  };
}

function mapRows<T>(
  value: unknown,
  mapper: (row: unknown) => T | null,
): T[] {
  if (!Array.isArray(value)) {
    throw upstreamError();
  }
  const mapped = value.flatMap((row) => {
    const result = mapper(row);
    return result ? [result] : [];
  });
  if (value.length > 0 && mapped.length === 0) {
    throw upstreamError();
  }
  return mapped;
}

export function mapTracks(value: unknown): Track[] {
  return mapRows(value, (row) => mapTrack(row));
}

function unavailableCatalogEntity(): AppError {
  return new AppError(
    "TRACK_UNAVAILABLE",
    "未找到这个公开音乐条目。",
    { retryable: false },
  );
}

function unavailableUserProfile(): AppError {
  return new AppError(
    "USER_NOT_FOUND",
    "未找到这个公开用户。",
    { retryable: false },
  );
}

function mapArtistProfile(value: unknown): Artist {
  const rawArtist = asRecord(value);
  const summary = mapArtist(rawArtist);
  if (!rawArtist || !summary) {
    throw unavailableCatalogEntity();
  }

  return {
    ...summary,
    aliases: stringArray(rawArtist.alias ?? rawArtist.aliases),
    biography: text(rawArtist.briefDesc ?? rawArtist.description),
    albumCount: nonNegativeNumber(rawArtist.albumSize),
    trackCount: nonNegativeNumber(rawArtist.musicSize),
  };
}

function mapAlbumDocument(value: unknown, tracks: Track[]): Album {
  const rawAlbum = asRecord(value);
  const summary = mapAlbum(rawAlbum);
  if (!rawAlbum || !summary) {
    throw unavailableCatalogEntity();
  }

  const artists = (childArray(rawAlbum, "artists", "artist") ?? []).flatMap((artist) => {
    const normalized = mapArtist(artist);
    return normalized ? [normalized] : [];
  });

  return {
    ...summary,
    artists,
    description: text(rawAlbum.description),
    publishedAt: nonNegativeNumber(rawAlbum.publishTime ?? rawAlbum.publishDate),
    trackCount: nonNegativeNumber(rawAlbum.size) ?? tracks.length,
  };
}

function mapPlaylist(value: unknown): Playlist | null {
  const playlist = asRecord(value);
  const id = playlist ? entityId(playlist.id) : null;
  const name = playlist ? text(playlist.name) : null;
  if (!playlist || !id || !name) {
    return null;
  }

  return {
    id,
    name,
    description: text(playlist.description),
    artworkUrl: publicMediaUrl(playlist.coverImgUrl ?? playlist.picUrl),
    owner: mapUser(playlist.creator),
    visibility: playlist.privacy === 10 ? "private" : "public",
    trackCount: nonNegativeNumber(playlist.trackCount) ?? 0,
    createdAt: nonNegativeNumber(playlist.createTime),
    updatedAt: nonNegativeNumber(playlist.updateTime),
  };
}

export function mapAlbumDetail(body: UnknownRecord): AlbumDetail {
  const tracks = mapTracks(body.songs ?? []);
  const rawAlbum = childRecord(body, "album");
  if (!rawAlbum) {
    throw unavailableCatalogEntity();
  }

  return {
    album: mapAlbumDocument(rawAlbum, tracks),
    tracks,
  };
}

export function mapArtistDetail(
  detailBody: UnknownRecord,
  hotTracksBody: UnknownRecord,
  albumsBody: UnknownRecord,
  page: { limit: number; offset: number },
): ArtistDetail {
  const detailData = childRecord(detailBody, "data") ?? detailBody;
  const rawArtist = childRecord(detailData, "artist") ?? childRecord(detailBody, "artist");
  if (!rawArtist) {
    throw unavailableCatalogEntity();
  }

  const hotTracks = mapTracks(hotTracksBody.songs ?? hotTracksBody.data ?? []);
  const albumItems = mapRows(albumsBody.hotAlbums ?? albumsBody.albums ?? [], mapAlbum);
  const total = nonNegativeNumber(albumsBody.total);
  const upstreamHasMore = typeof albumsBody.more === "boolean" ? albumsBody.more : null;

  return {
    artist: mapArtistProfile(rawArtist),
    hotTracks,
    albums: {
      items: albumItems,
      total,
      limit: page.limit,
      offset: page.offset,
      hasMore: upstreamHasMore ?? hasMore(total, page.offset, albumItems.length, page.limit),
    },
  };
}

export function mapNewSongs(body: UnknownRecord): Track[] {
  const rows = body.result ?? body.data ?? [];
  if (!Array.isArray(rows)) {
    throw upstreamError();
  }
  return mapRows(rows, (row) => {
    const record = asRecord(row);
    return mapTrack(record?.song ?? record);
  });
}

export function mapPlaylistPage(
  body: UnknownRecord,
  page: { limit: number; offset: number },
): CatalogPage<Playlist> {
  const items = mapRows(body.playlists ?? [], mapPlaylist);
  const total = nonNegativeNumber(body.total);
  const upstreamHasMore = typeof body.more === "boolean" ? body.more : null;

  return {
    items,
    total,
    limit: page.limit,
    offset: page.offset,
    hasMore: upstreamHasMore ?? hasMore(total, page.offset, items.length, page.limit),
  };
}

function playlistOwnerId(value: unknown): string | null {
  const playlist = asRecord(value);
  const creator = playlist ? asRecord(playlist.creator) : null;
  return creator ? entityId(creator.userId ?? creator.id) : null;
}

function playlistSpecialType(value: unknown): number | null {
  const playlist = asRecord(value);
  return playlist ? nonNegativeNumber(playlist.specialType) : null;
}

export function mapUserProfile(body: UnknownRecord): UserProfile {
  const profile = mapUser(body.profile ?? body.user ?? body);
  if (!profile) {
    throw unavailableUserProfile();
  }
  return profile;
}

export function mapUserPlaylistCollection(
  body: UnknownRecord,
  userId: string,
): UserPlaylistCollection {
  const rows = body.playlist ?? body.playlists;
  if (!Array.isArray(rows)) {
    throw upstreamError();
  }

  const collection: UserPlaylistCollection = {
    liked: null,
    created: [],
    subscribed: [],
  };
  let normalizedRows = 0;

  for (const row of rows) {
    const playlist = mapPlaylist(row);
    if (!playlist) {
      continue;
    }
    normalizedRows += 1;

    const ownedByProfile = playlistOwnerId(row) === userId;
    if (ownedByProfile && playlistSpecialType(row) === 5) {
      collection.liked ??= playlist;
    } else if (ownedByProfile) {
      collection.created.push(playlist);
    } else {
      collection.subscribed.push(playlist);
    }
  }

  if (rows.length > 0 && normalizedRows === 0) {
    throw upstreamError();
  }

  return collection;
}

function hasMore(total: number | null, offset: number, count: number, limit: number) {
  return total !== null ? offset + count < total : count === limit;
}

export function unwrapLegacyBody(response: LegacyApiResponse): UnknownRecord {
  const status = finiteNumber(response.status);
  const body = asRecord(response.body);
  const code = body ? finiteNumber(body.code) : null;

  if (status === 429 || code === 429) {
    throw new AppError("RATE_LIMITED", "请求过于频繁，请稍后重试。", {
      retryable: true,
    });
  }
  if (!body || status === null || status < 200 || status >= 300 || code !== 200) {
    throw upstreamError("网易云服务暂时不可用。");
  }
  return body;
}

export function unwrapLegacyQrBody(response: LegacyApiResponse): UnknownRecord {
  const status = finiteNumber(response.status);
  const body = asRecord(response.body);
  if (!body || status === null || status < 200 || status >= 300) {
    throw upstreamError("二维码状态暂时无法获取。");
  }
  return body;
}

export function mapQrChallenge(
  keyBody: UnknownRecord,
  imageBody: UnknownRecord,
): LegacyQrChallenge {
  const keyData = childRecord(keyBody, "data");
  const imageData = childRecord(imageBody, "data");
  const key = keyData ? text(keyData.unikey) : null;
  const qrImageDataUrl = imageData ? text(imageData.qrimg) : null;
  if (!key || key.length > 256 || !qrImageDataUrl?.startsWith("data:image/")) {
    throw upstreamError("二维码暂时无法生成。");
  }
  return { key, qrImageDataUrl };
}

export function mapSessionUser(response: LegacyApiResponse): UserProfile | null {
  const status = finiteNumber(response.status);
  const body = asRecord(response.body);
  if (!body || status === null || status < 200 || status >= 300) {
    throw upstreamError("登录状态暂时无法获取。");
  }
  const data = childRecord(body, "data");
  if (!data) {
    throw upstreamError("登录状态暂时无法识别。");
  }
  const code = finiteNumber(data.code);
  if (code === 301) {
    return null;
  }
  if (code !== 200) {
    throw upstreamError("登录状态暂时无法识别。");
  }
  const account = childRecord(data, "account");
  const profile = childRecord(data, "profile");
  if (!account || !profile) {
    return null;
  }
  const id = entityId(account.id) ?? entityId(profile.userId);
  const nickname = text(profile.nickname);
  if (!id || !nickname) {
    return null;
  }
  return {
    id,
    nickname,
    avatarUrl: publicMediaUrl(profile.avatarUrl),
    signature: text(profile.signature),
  };
}

export function mapSearchPage(
  body: UnknownRecord,
  type: "track",
  limit: number,
  offset: number,
): SearchPage<Track, "track">;
export function mapSearchPage(
  body: UnknownRecord,
  type: "album",
  limit: number,
  offset: number,
): SearchPage<AlbumSummary, "album">;
export function mapSearchPage(
  body: UnknownRecord,
  type: "artist",
  limit: number,
  offset: number,
): SearchPage<ArtistSummary, "artist">;
export function mapSearchPage(
  body: UnknownRecord,
  type: SearchKind,
  limit: number,
  offset: number,
): SearchPage<Track, "track"> | SearchPage<AlbumSummary, "album">
  | SearchPage<ArtistSummary, "artist"> {
  const result = childRecord(body, "result");
  if (!result) {
    throw upstreamError();
  }

  if (type === "track") {
    const items = mapTracks(result.songs ?? []);
    const total = nonNegativeNumber(result.songCount);
    return {
      type,
      items,
      total,
      limit,
      offset,
      hasMore: hasMore(total, offset, items.length, limit),
    };
  }
  if (type === "album") {
    const items = mapRows(result.albums ?? [], mapAlbum);
    const total = nonNegativeNumber(result.albumCount);
    return {
      type,
      items,
      total,
      limit,
      offset,
      hasMore: hasMore(total, offset, items.length, limit),
    };
  }

  const items = mapRows(result.artists ?? [], mapArtist);
  const total = nonNegativeNumber(result.artistCount);
  return {
    type,
    items,
    total,
    limit,
    offset,
    hasMore: hasMore(total, offset, items.length, limit),
  };
}

export function mapTrackDetail(body: UnknownRecord, trackId: string): Track {
  const rawSongs = Array.isArray(body.songs) ? body.songs : null;
  if (!rawSongs) {
    throw upstreamError();
  }
  const privileges = Array.isArray(body.privileges) ? body.privileges : [];
  const privilegeById = new Map<string, UnknownRecord>();
  for (const value of privileges) {
    const privilege = asRecord(value);
    const id = privilege ? entityId(privilege.id) : null;
    if (privilege && id) {
      privilegeById.set(id, privilege);
    }
  }

  for (const value of rawSongs) {
    const row = asRecord(value);
    const id = row ? entityId(row.id) : null;
    if (row && id === trackId) {
      const mapped = mapTrack(row, privilegeById.get(id) ?? null);
      if (mapped) {
        return mapped;
      }
      break;
    }
  }

  throw new AppError("TRACK_UNAVAILABLE", "未找到指定歌曲。", {
    details: { trackId },
  });
}

export function assertTrackPlayable(body: UnknownRecord, trackId: string): void {
  if (body.success !== true) {
    throw new AppError("TRACK_UNAVAILABLE", "当前歌曲无法播放。", {
      details: { trackId },
    });
  }
}

export function mapPlaybackSource(
  body: UnknownRecord,
  trackId: string,
  requestedQuality: AudioQuality,
  receivedAt: number,
): PlaybackSource {
  const rows = Array.isArray(body.data) ? body.data : null;
  if (!rows) {
    throw upstreamError();
  }
  const row = rows
    .map(asRecord)
    .find((candidate) => candidate && entityId(candidate.id) === trackId) ?? null;
  const url = row ? playbackUrl(row.url) : null;
  if (!row || finiteNumber(row.code) !== 200 || !url) {
    throw new AppError("TRACK_UNAVAILABLE", "当前歌曲没有可用音源。", {
      details: { trackId },
    });
  }

  const expiSeconds = nonNegativeNumber(row.expi);
  const expiresAt = receivedAt + (expiSeconds && expiSeconds > 0
    ? expiSeconds * 1_000
    : 300_000);

  return {
    url,
    expiresAt,
    quality: quality(row.level) ?? requestedQuality,
    codec: text(row.encodeType ?? row.type),
    bitrate: nonNegativeNumber(row.br),
    sampleRate: nonNegativeNumber(row.sr),
    sizeBytes: nonNegativeNumber(row.size),
    corsMode: "unavailable",
  };
}

function nestedLyric(body: UnknownRecord, key: string): string | null {
  return text(asRecord(body[key])?.lyric);
}

export function mapLyrics(body: UnknownRecord): LyricDocument {
  return parseLyrics({
    lrc: nestedLyric(body, "lrc"),
    tlyric: nestedLyric(body, "tlyric"),
    romalrc: nestedLyric(body, "romalrc"),
    yrc: nestedLyric(body, "yrc"),
    instrumental: body.nolyric === true,
  });
}

function mapComment(value: unknown): Comment | null {
  const comment = asRecord(value);
  const id = comment ? entityId(comment.commentId ?? comment.id) : null;
  const author = comment ? mapUser(comment.user) : null;
  const content = comment ? text(comment.content) : null;
  const createdAt = comment ? nonNegativeNumber(comment.time) : null;
  if (!comment || !id || !author || !content || createdAt === null) {
    return null;
  }

  const rawReply = Array.isArray(comment.beReplied) ? comment.beReplied[0] : null;
  const reply = asRecord(rawReply);
  const replyUser = reply ? asRecord(reply.user) : null;
  const replyId = reply ? entityId(reply.beRepliedCommentId ?? reply.commentId) : null;
  const replyNickname = replyUser ? text(replyUser.nickname) : null;

  return {
    id,
    author,
    content,
    createdAt,
    likedCount: nonNegativeNumber(comment.likedCount) ?? 0,
    likedByCurrentUser: comment.liked === true,
    replyTo: replyId && replyNickname
      ? { id: replyId, nickname: replyNickname }
      : null,
  };
}

export function mapCommentPage(
  body: UnknownRecord,
  limit: number,
  offset: number,
): CommentPage {
  const items = mapRows(body.comments ?? [], mapComment);
  const total = nonNegativeNumber(body.total);
  const upstreamHasMore = typeof body.more === "boolean" ? body.more : null;
  return {
    items,
    total,
    limit,
    offset,
    hasMore: upstreamHasMore ?? hasMore(total, offset, items.length, limit),
  };
}

export function mapQrPollResult(body: UnknownRecord): LegacyQrPollResult {
  const code = finiteNumber(body.code);
  if (code === 800) {
    return { status: "expired" };
  }
  if (code === 801) {
    return { status: "waiting" };
  }
  if (code === 802) {
    return { status: "scanned" };
  }
  if (code === 803) {
    const upstreamCookie = text(body.cookie);
    if (upstreamCookie) {
      return { status: "authorized", upstreamCookie };
    }
  }
  throw upstreamError("二维码状态暂时无法识别。");
}
