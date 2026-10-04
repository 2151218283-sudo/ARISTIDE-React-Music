"use client";

import { appErrorCodes, type AppErrorCode } from "@/lib/music/errors";
import type {
  AlbumSummary,
  CatalogPage,
  LibraryMutationResult,
  Track,
} from "@/lib/music/models";

export class LibraryClientError extends Error {
  readonly code: AppErrorCode;
  readonly retryable: boolean;

  constructor(code: AppErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "LibraryClientError";
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

function isArtist(value: unknown): boolean {
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
    && value.artists.every(isArtist)
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

function isPage<T>(value: unknown, item: (value: unknown) => value is T): value is CatalogPage<T> {
  return isRecord(value)
    && Array.isArray(value.items)
    && value.items.every(item)
    && (value.total === null || (typeof value.total === "number" && Number.isFinite(value.total)))
    && typeof value.limit === "number"
    && typeof value.offset === "number"
    && typeof value.hasMore === "boolean";
}

function isMutationResult(value: unknown): value is LibraryMutationResult {
  return isRecord(value)
    && (value.kind === "track-like" || value.kind === "album-collection")
    && typeof value.id === "string"
    && typeof value.active === "boolean";
}

function toClientError(body: unknown, status: number): LibraryClientError {
  if (isRecord(body) && isRecord(body.error)) {
    const { code, message, retryable } = body.error;
    if (typeof code === "string" && appErrorCodes.includes(code as AppErrorCode)) {
      return new LibraryClientError(
        code as AppErrorCode,
        typeof message === "string" ? message : "音乐库写入未完成。",
        retryable === true,
      );
    }
  }
  return new LibraryClientError(
    status === 401 ? "AUTH_REQUIRED" : "UPSTREAM_UNAVAILABLE",
    status === 401 ? "请先完成扫码登录。" : "音乐库暂时不可用，请稍后重试。",
    status !== 401,
  );
}

async function requestData<T>(
  path: string,
  isData: (value: unknown) => value is T,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new LibraryClientError("NETWORK_ERROR", "网络连接失败，请重试。", true);
  }
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

export function requestLikedTracks(signal?: AbortSignal): Promise<CatalogPage<Track>> {
  return requestData(
    "/api/library/likes?limit=50&offset=0",
    (value): value is CatalogPage<Track> => isPage(value, isTrack),
    { signal },
  );
}

export function requestSavedAlbums(signal?: AbortSignal): Promise<CatalogPage<AlbumSummary>> {
  return requestData(
    "/api/library/albums?limit=50&offset=0",
    (value): value is CatalogPage<AlbumSummary> => isPage(value, isAlbumSummary),
    { signal },
  );
}

export function requestTrackLike(
  trackId: string,
  liked: boolean,
  clientMutationId: string,
): Promise<LibraryMutationResult> {
  return requestData(
    `/api/library/likes/${encodeURIComponent(trackId)}`,
    isMutationResult,
    {
      body: JSON.stringify({ clientMutationId }),
      headers: { "Content-Type": "application/json" },
      method: liked ? "PUT" : "DELETE",
    },
  );
}

export function requestAlbumCollection(
  albumId: string,
  collected: boolean,
  clientMutationId: string,
): Promise<LibraryMutationResult> {
  return requestData(
    `/api/library/albums/${encodeURIComponent(albumId)}`,
    isMutationResult,
    {
      body: JSON.stringify({ clientMutationId }),
      headers: { "Content-Type": "application/json" },
      method: collected ? "PUT" : "DELETE",
    },
  );
}
