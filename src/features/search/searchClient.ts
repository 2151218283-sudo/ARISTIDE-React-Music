"use client";

import { appErrorCodes, type AppErrorCode } from "@/lib/music/errors";
import type {
  AlbumSummary,
  ArtistSummary,
  SearchAllResult,
  SearchPartialError,
  SearchResponse,
  SearchType,
  Track,
} from "@/lib/music/models";

const searchTypes: readonly SearchType[] = ["all", "track", "album", "artist"];

export interface SearchRequest {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
  text: string;
  type: SearchType;
}

export class SearchClientError extends Error {
  readonly code: AppErrorCode;
  readonly retryable: boolean;

  constructor(code: AppErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "SearchClientError";
    this.code = code;
    this.retryable = retryable;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
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

function isSearchPartialError(value: unknown): value is SearchPartialError {
  return isRecord(value)
    && (value.type === "track" || value.type === "album" || value.type === "artist")
    && typeof value.code === "string"
    && appErrorCodes.includes(value.code as AppErrorCode)
    && typeof value.retryable === "boolean";
}

function isSearchAllResult(value: unknown): value is SearchAllResult {
  if (!isRecord(value) || value.type !== "all") {
    return false;
  }

  const sections = [
    [value.tracks, isTrack],
    [value.artists, isArtistSummary],
    [value.albums, isAlbumSummary],
  ] as const;

  return sections.every(([section, isItem]) => (
    isRecord(section)
    && Array.isArray(section.items)
    && section.items.every(isItem)
    && (section.total === null || typeof section.total === "number")
    && typeof section.hasMore === "boolean"
  ))
    && Array.isArray(value.partialErrors)
    && value.partialErrors.every(isSearchPartialError);
}

function isSearchResponse(value: unknown): value is SearchResponse {
  if (isSearchAllResult(value)) {
    return true;
  }

  if (!isRecord(value)
    || (value.type !== "track" && value.type !== "album" && value.type !== "artist")
    || !Array.isArray(value.items)
    || (value.total !== null && typeof value.total !== "number")
    || typeof value.limit !== "number"
    || typeof value.offset !== "number"
    || typeof value.hasMore !== "boolean") {
    return false;
  }

  if (value.type === "track") {
    return value.items.every(isTrack);
  }
  if (value.type === "album") {
    return value.items.every(isAlbumSummary);
  }
  return value.items.every(isArtistSummary);
}

function toClientError(body: unknown, status: number): SearchClientError {
  if (isRecord(body) && isRecord(body.error)) {
    const { code, message, retryable } = body.error;
    if (typeof code === "string" && appErrorCodes.includes(code as AppErrorCode)) {
      return new SearchClientError(
        code as AppErrorCode,
        typeof message === "string" ? message : "搜索服务暂时不可用。",
        retryable === true,
      );
    }
  }

  return new SearchClientError(
    status === 401 ? "AUTH_REQUIRED" : "UPSTREAM_UNAVAILABLE",
    status === 401 ? "登录状态已失效，请重新登录。" : "搜索服务暂时不可用。",
    status !== 401,
  );
}

export function isSearchType(value: string | null): value is SearchType {
  return value !== null && searchTypes.includes(value as SearchType);
}

export async function requestSearch({
  limit = 20,
  offset = 0,
  signal,
  text,
  type,
}: SearchRequest): Promise<SearchResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    q: text,
    type,
  });
  const response = await fetch(`/api/search?${params.toString()}`, {
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

  if (!response.ok || !isRecord(body) || body.ok !== true || !isSearchResponse(body.data)) {
    throw toClientError(body, response.status);
  }

  return body.data;
}
