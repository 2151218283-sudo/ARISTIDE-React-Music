"use client";

import { appErrorCodes, type AppErrorCode } from "@/lib/music/errors";
import type { Playlist, PlaylistDetail, PlaylistUpdate, Track } from "@/lib/music/models";

export class PlaylistClientError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PlaylistClientError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function playlist(value: unknown): value is Playlist {
  const item = record(value);
  return item !== null
    && typeof item.id === "string"
    && typeof item.name === "string"
    && (item.description === null || typeof item.description === "string")
    && Array.isArray(item.tags) && item.tags.every((tag) => typeof tag === "string")
    && (item.artworkUrl === null || typeof item.artworkUrl === "string")
    && (item.visibility === "public" || item.visibility === "private")
    && typeof item.trackCount === "number";
}

function track(value: unknown): value is Track {
  const item = record(value);
  return item !== null
    && typeof item.id === "string"
    && typeof item.name === "string"
    && Array.isArray(item.artists)
    && item.artists.every((artist) => {
      const result = record(artist);
      return result !== null && typeof result.id === "string" && typeof result.name === "string";
    })
    && record(item.album) !== null
    && typeof record(item.album)?.id === "string"
    && typeof item.durationMs === "number"
    && (item.artworkUrl === null || typeof item.artworkUrl === "string")
    && Array.isArray(item.aliases)
    && typeof item.availability === "string"
    && record(item.privilege) !== null;
}

function detail(value: unknown): value is PlaylistDetail {
  const item = record(value);
  return item !== null && playlist(item.playlist)
    && Array.isArray(item.tracks) && item.tracks.every(track)
    && typeof item.canEdit === "boolean";
}

function deleted(value: unknown): value is { playlistId: string; deleted: true } {
  const item = record(value);
  return item !== null && typeof item.playlistId === "string" && item.deleted === true;
}

function tracksChanged(value: unknown): value is { playlistId: string; operation: string; trackIds: string[] } {
  const item = record(value);
  return item !== null && typeof item.playlistId === "string"
    && (item.operation === "add" || item.operation === "remove")
    && Array.isArray(item.trackIds) && item.trackIds.every((id) => typeof id === "string");
}

function updated(value: unknown): value is { playlistId: string; field: PlaylistUpdate["field"] } {
  const item = record(value);
  return item !== null && typeof item.playlistId === "string"
    && (item.field === "name" || item.field === "description" || item.field === "tags" || item.field === "publish");
}

function clientError(value: unknown, status: number): PlaylistClientError {
  const error = record(record(value)?.error);
  const code = error?.code;
  if (error && typeof code === "string" && appErrorCodes.includes(code as AppErrorCode)) {
    return new PlaylistClientError(
      code as AppErrorCode,
      typeof error.message === "string" ? error.message : "歌单请求未完成。",
      error.retryable === true,
    );
  }
  return new PlaylistClientError(
    status === 401 ? "AUTH_REQUIRED" : "UPSTREAM_UNAVAILABLE",
    status === 401 ? "请先完成扫码登录。" : "歌单服务暂时不可用。",
    status !== 401,
  );
}

async function request<T>(path: string, valid: (value: unknown) => value is T, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json", ...init?.headers },
    });
  } catch {
    throw new PlaylistClientError("NETWORK_ERROR", "网络连接失败，请重试。", true);
  }
  let body: unknown;
  try { body = await response.json(); } catch { throw clientError(null, response.status); }
  const envelope = record(body);
  if (!response.ok || envelope?.ok !== true || !valid(envelope.data)) {
    throw clientError(body, response.status);
  }
  return envelope.data;
}

export function requestPlaylist(id: string, signal?: AbortSignal): Promise<PlaylistDetail> {
  return request(`/api/playlists/${encodeURIComponent(id)}`, detail, { signal });
}

export function createPlaylist(name: string, visibility: "public" | "private", clientMutationId: string): Promise<Playlist> {
  return request("/api/playlists", playlist, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, visibility, clientMutationId }),
  });
}

export function deletePlaylist(id: string, clientMutationId: string): Promise<{ playlistId: string; deleted: true }> {
  return request(`/api/playlists/${encodeURIComponent(id)}`, deleted, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientMutationId }),
  });
}

export function updatePlaylist(id: string, update: PlaylistUpdate, clientMutationId: string): Promise<{ playlistId: string; field: PlaylistUpdate["field"] }> {
  return request(`/api/playlists/${encodeURIComponent(id)}`, updated, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...update, clientMutationId }),
  });
}

export function changePlaylistTracks(
  id: string,
  trackIds: string[],
  operation: "add" | "remove",
  clientMutationId: string,
): Promise<{ playlistId: string; operation: string; trackIds: string[] }> {
  return request(`/api/playlists/${encodeURIComponent(id)}/tracks`, tracksChanged, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, trackIds, clientMutationId }),
  });
}

export function createMutationId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replaceAll("-", "");
  }
  return `echoform-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
