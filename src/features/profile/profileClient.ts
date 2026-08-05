"use client";

import { appErrorCodes, type AppErrorCode } from "@/lib/music/errors";
import type {
  Playlist,
  UserPlaylistCollection,
  UserProfile,
  UserProfileOverview,
} from "@/lib/music/models";

export class ProfileClientError extends Error {
  readonly code: AppErrorCode;
  readonly retryable: boolean;

  constructor(code: AppErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "ProfileClientError";
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

function isUserProfile(value: unknown): value is UserProfile {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.nickname === "string"
    && isNullableString(value.avatarUrl)
    && isNullableString(value.signature);
}

function isPlaylist(value: unknown): value is Playlist {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && isNullableString(value.description)
    && isNullableString(value.artworkUrl)
    && (value.owner === null || isUserProfile(value.owner))
    && (value.visibility === "public" || value.visibility === "private")
    && typeof value.trackCount === "number"
    && Number.isFinite(value.trackCount)
    && isNullableNumber(value.createdAt)
    && isNullableNumber(value.updatedAt);
}

function isUserProfileOverview(value: unknown): value is UserProfileOverview {
  return isRecord(value)
    && isUserProfile(value.profile)
    && typeof value.isCurrentUser === "boolean"
    && isRecord(value.recentPlays)
    && value.recentPlays.state === "unavailable"
    && value.recentPlays.reason === "upstream-not-verified";
}

function isUserPlaylistCollection(value: unknown): value is UserPlaylistCollection {
  return isRecord(value)
    && (value.liked === null || isPlaylist(value.liked))
    && Array.isArray(value.created)
    && value.created.every(isPlaylist)
    && Array.isArray(value.subscribed)
    && value.subscribed.every(isPlaylist);
}

function toClientError(body: unknown, status: number): ProfileClientError {
  if (isRecord(body) && isRecord(body.error)) {
    const { code, message, retryable } = body.error;
    if (typeof code === "string" && appErrorCodes.includes(code as AppErrorCode)) {
      return new ProfileClientError(
        code as AppErrorCode,
        typeof message === "string" ? message : "用户主页暂时不可用。",
        retryable === true,
      );
    }
  }

  return new ProfileClientError(
    status === 404 ? "USER_NOT_FOUND" : "UPSTREAM_UNAVAILABLE",
    status === 404 ? "未找到这个公开用户。" : "用户主页暂时不可用。",
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

export function requestUserProfile(
  userId: string,
  signal?: AbortSignal,
): Promise<UserProfileOverview> {
  return requestData(
    `/api/users/${encodeURIComponent(userId)}`,
    isUserProfileOverview,
    signal,
  );
}

export function requestUserPlaylists(
  userId: string,
  signal?: AbortSignal,
): Promise<UserPlaylistCollection> {
  return requestData(
    `/api/users/${encodeURIComponent(userId)}/playlists?limit=30&offset=0`,
    isUserPlaylistCollection,
    signal,
  );
}
