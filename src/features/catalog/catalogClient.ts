"use client";

import { appErrorCodes, type AppErrorCode } from "@/lib/music/errors";
import type {
  Album,
  AlbumDetail,
  AlbumSummary,
  Artist,
  ArtistDetail,
  ArtistSummary,
  CatalogPage,
  Playlist,
  Track,
} from "@/lib/music/models";

export class CatalogClientError extends Error {
  readonly code: AppErrorCode;
  readonly retryable: boolean;

  constructor(code: AppErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "CatalogClientError";
    this.code = code;
    this.retryable = retryable;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isArtistSummary(value: unknown): value is ArtistSummary {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && isNullableString(value.avatarUrl);
}

function isAlbumSummary(value: unknown): value is AlbumSummary {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && isNullableString(value.artworkUrl);
}

function isTrack(value: unknown): value is Track {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && Array.isArray(value.artists)
    && value.artists.every(isArtistSummary)
    && isAlbumSummary(value.album)
    && typeof value.durationMs === "number"
    && Number.isFinite(value.durationMs)
    && isNullableString(value.artworkUrl)
    && Array.isArray(value.aliases)
    && value.aliases.every((alias) => typeof alias === "string")
    && typeof value.explicit === "boolean"
    && typeof value.availability === "string"
    && isRecord(value.privilege);
}

function isAlbum(value: unknown): value is Album {
  if (!isRecord(value) || !isAlbumSummary(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.artists)
    && record.artists.every(isArtistSummary)
    && isNullableString(record.description)
    && isNullableNumber(record.publishedAt)
    && typeof record.trackCount === "number";
}

function isArtist(value: unknown): value is Artist {
  if (!isRecord(value) || !isArtistSummary(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.aliases)
    && record.aliases.every((alias) => typeof alias === "string")
    && isNullableString(record.biography)
    && isNullableNumber(record.albumCount)
    && isNullableNumber(record.trackCount);
}

function isCatalogPage<T>(
  value: unknown,
  isItem: (item: unknown) => item is T,
): value is CatalogPage<T> {
  return isRecord(value)
    && Array.isArray(value.items)
    && value.items.every(isItem)
    && isNullableNumber(value.total)
    && typeof value.limit === "number"
    && typeof value.offset === "number"
    && typeof value.hasMore === "boolean";
}

function isAlbumDetail(value: unknown): value is AlbumDetail {
  return isRecord(value)
    && isAlbum(value.album)
    && Array.isArray(value.tracks)
    && value.tracks.every(isTrack);
}

function isArtistDetail(value: unknown): value is ArtistDetail {
  return isRecord(value)
    && isArtist(value.artist)
    && Array.isArray(value.hotTracks)
    && value.hotTracks.every(isTrack)
    && isCatalogPage(value.albums, isAlbumSummary);
}

function isPlaylist(value: unknown): value is Playlist {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && isNullableString(value.description)
    && isNullableString(value.artworkUrl)
    && (value.owner === null || isRecord(value.owner))
    && (value.visibility === "public" || value.visibility === "private")
    && typeof value.trackCount === "number"
    && isNullableNumber(value.createdAt)
    && isNullableNumber(value.updatedAt);
}

function toClientError(body: unknown, status: number): CatalogClientError {
  if (isRecord(body) && isRecord(body.error)) {
    const { code, message, retryable } = body.error;
    if (typeof code === "string" && appErrorCodes.includes(code as AppErrorCode)) {
      return new CatalogClientError(
        code as AppErrorCode,
        typeof message === "string" ? message : "目录服务暂时不可用。",
        retryable === true,
      );
    }
  }

  return new CatalogClientError(
    status === 404 ? "TRACK_UNAVAILABLE" : "UPSTREAM_UNAVAILABLE",
    status === 404 ? "未找到这个公开音乐条目。" : "目录服务暂时不可用。",
    status !== 404,
  );
}

async function requestData<T>(
  path: string,
  isData: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw toClientError(null, response.status);
  }

  if (!response.ok || !isRecord(body) || body.ok !== true || !isData(body.data)) {
    throw toClientError(body, response.status);
  }
  return body.data;
}

export function requestAlbum(
  albumId: string,
  signal?: AbortSignal,
): Promise<AlbumDetail> {
  return requestData(
    `/api/albums/${encodeURIComponent(albumId)}`,
    isAlbumDetail,
    signal,
  );
}

export function requestArtist(
  artistId: string,
  page: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<ArtistDetail> {
  const params = new URLSearchParams({
    limit: String(page.limit ?? 20),
    offset: String(page.offset ?? 0),
  });
  return requestData(
    `/api/artists/${encodeURIComponent(artistId)}?${params.toString()}`,
    isArtistDetail,
    signal,
  );
}

export function requestNewSongs(
  signal?: AbortSignal,
): Promise<Track[]> {
  return requestData("/api/discovery/new-songs?limit=12", (value): value is Track[] => (
    Array.isArray(value) && value.every(isTrack)
  ), signal);
}

export function requestPopularPlaylists(
  signal?: AbortSignal,
): Promise<CatalogPage<Playlist>> {
  return requestData(
    "/api/discovery/popular-playlists?limit=8&offset=0",
    (value): value is CatalogPage<Playlist> => isCatalogPage(value, isPlaylist),
    signal,
  );
}
