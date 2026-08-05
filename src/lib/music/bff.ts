import { randomUUID } from "node:crypto";

import {
  createApiFailure,
  createApiSuccess,
  type ApiResult,
} from "./apiResult";
import { AppError, isAppError, type AppErrorCode } from "./errors";
import type {
  AlbumDetail,
  ArtistDetail,
  AudioQuality,
  CatalogPage,
  CommentPage,
  LyricDocument,
  PageQuery,
  PlaybackAvailability,
  PlaybackSource,
  Playlist,
  SearchQuery,
  SearchResponse,
  Track,
} from "./models";

const trackIdPattern = /^\d{1,20}$/;
const searchTypes = ["all", "track", "album", "artist"] as const;
const audioQualities = ["standard", "exhigh", "lossless", "hires"] as const;
const publicMetadataCacheControl = "public, max-age=300, s-maxage=300";
const commentCacheControl = "public, max-age=30, s-maxage=30";
const noStoreCacheControl = "no-store";

type SearchType = (typeof searchTypes)[number];

export interface PublicReadProvider {
  search(query: SearchQuery): Promise<SearchResponse>;
  getTrack(trackId: string): Promise<Track>;
  getPlaybackSource(
    trackId: string,
    quality: AudioQuality,
    upstreamCookie?: string,
  ): Promise<PlaybackSource>;
  getLyrics(trackId: string): Promise<LyricDocument>;
  getComments(trackId: string, page: PageQuery): Promise<CommentPage>;
}

export interface PublicReadRouteHandlers {
  search(request: Request): Promise<Response>;
  track(request: Request, trackId: string): Promise<Response>;
  source(request: Request, trackId: string): Promise<Response>;
  availability(request: Request, trackId: string): Promise<Response>;
  lyrics(request: Request, trackId: string): Promise<Response>;
  comments(request: Request, trackId: string): Promise<Response>;
}

export interface CatalogReadProvider {
  getAlbum(albumId: string): Promise<AlbumDetail>;
  getArtist(artistId: string, page: PageQuery): Promise<ArtistDetail>;
  getNewSongs(limit: number): Promise<Track[]>;
  getPopularPlaylists(page: PageQuery): Promise<CatalogPage<Playlist>>;
}

export interface CatalogReadRouteHandlers {
  album(request: Request, albumId: string): Promise<Response>;
  artist(request: Request, artistId: string): Promise<Response>;
  newSongs(request: Request): Promise<Response>;
  popularPlaylists(request: Request): Promise<Response>;
}

export interface PublicReadRouteDependencies {
  createProvider: () => PublicReadProvider;
  createRequestId?: () => string;
  now?: () => number;
  retryDelay?: (delayMs: number) => Promise<void>;
  random?: () => number;
  resolvePlaybackCredential?: (request: Request) => string | undefined;
  timeoutMs?: {
    default: number;
    source: number;
  };
}

export interface CatalogReadRouteDependencies {
  createProvider: () => CatalogReadProvider;
  createRequestId?: () => string;
  now?: () => number;
  retryDelay?: (delayMs: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
}

interface ReadDependencies {
  now: () => number;
  retryDelay: (delayMs: number) => Promise<void>;
  random: () => number;
}

interface ResolvedDependencies extends ReadDependencies {
  createProvider: () => PublicReadProvider;
  createRequestId: () => string;
  resolvePlaybackCredential: (request: Request) => string | undefined;
  timeoutMs: {
    default: number;
    source: number;
  };
}

interface ResolvedCatalogDependencies extends ReadDependencies {
  createProvider: () => CatalogReadProvider;
  createRequestId: () => string;
  timeoutMs: number;
}

interface ReadRouteOptions<T> {
  cacheControl: string;
  requestId: string;
  timeoutMs: number;
  dependencies: ReadDependencies;
  execute: (signal: AbortSignal) => Promise<T>;
  statusForError?: (code: AppErrorCode) => number;
}

function defaultRetryDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function validationError(message: string): AppError {
  return new AppError("VALIDATION_ERROR", message);
}

function parseNonNegativeInteger(
  value: string | null,
  defaultValue: number,
  maximum: number,
  name: string,
): number {
  if (value === null) {
    return defaultValue;
  }
  if (!/^\d+$/.test(value)) {
    throw validationError(`${name} 必须是整数。`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw validationError(`${name} 超出允许范围。`);
  }
  return parsed;
}

function parsePositiveInteger(
  value: string | null,
  defaultValue: number,
  maximum: number,
  name: string,
): number {
  const parsed = parseNonNegativeInteger(value, defaultValue, maximum, name);
  if (parsed < 1) {
    throw validationError(`${name} 必须大于零。`);
  }
  return parsed;
}

function parseTrackId(trackId: string): string {
  const normalized = trackId.trim();
  if (!trackIdPattern.test(normalized)) {
    throw validationError("歌曲 ID 格式无效。");
  }
  return normalized;
}

function parseCatalogId(value: string, label: string): string {
  const normalized = value.trim();
  if (!trackIdPattern.test(normalized)) {
    throw validationError(`${label} ID 格式无效。`);
  }
  return normalized;
}

function parseSearchQuery(request: Request): SearchQuery {
  const params = new URL(request.url).searchParams;
  const text = params.get("q")?.trim() ?? "";
  const type = params.get("type") ?? "all";
  if (text.length < 1 || text.length > 100) {
    throw validationError("搜索关键词长度必须是 1 至 100 个字符。");
  }
  if (!searchTypes.includes(type as SearchType)) {
    throw validationError("搜索类型无效。");
  }

  return {
    text,
    type: type as SearchType,
    limit: parsePositiveInteger(params.get("limit"), 20, 30, "limit"),
    offset: parseNonNegativeInteger(params.get("offset"), 0, Number.MAX_SAFE_INTEGER, "offset"),
  };
}

function parseCommentsPage(request: Request): PageQuery {
  const params = new URL(request.url).searchParams;
  return {
    limit: parsePositiveInteger(params.get("limit"), 20, 100, "limit"),
    offset: parseNonNegativeInteger(params.get("offset"), 0, Number.MAX_SAFE_INTEGER, "offset"),
  };
}

function parseCatalogPage(
  request: Request,
  defaultLimit: number,
): PageQuery {
  const params = new URL(request.url).searchParams;
  return {
    limit: parsePositiveInteger(params.get("limit"), defaultLimit, 30, "limit"),
    offset: parseNonNegativeInteger(params.get("offset"), 0, Number.MAX_SAFE_INTEGER, "offset"),
  };
}

function parseNewSongLimit(request: Request): number {
  return parsePositiveInteger(
    new URL(request.url).searchParams.get("limit"),
    12,
    30,
    "limit",
  );
}

function parseAudioQuality(request: Request): AudioQuality {
  const quality = new URL(request.url).searchParams.get("quality") ?? "standard";
  if (!audioQualities.includes(quality as AudioQuality)) {
    throw validationError("音质参数无效。");
  }
  return quality as AudioQuality;
}

function isRetryableReadError(error: AppError): boolean {
  return error.code === "RATE_LIMITED"
    || error.code === "UPSTREAM_TIMEOUT"
    || error.code === "NETWORK_ERROR";
}

function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }
  return new AppError(
    "UNKNOWN_ERROR",
    "请求未能完成，请稍后重试。",
    { retryable: true },
  );
}

function statusForError(code: AppErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "AUTH_REQUIRED":
    case "SESSION_EXPIRED":
      return 401;
    case "VIP_REQUIRED":
      return 403;
    case "TRACK_UNAVAILABLE":
    case "SOURCE_EXPIRED":
      return 409;
    case "QR_EXPIRED":
      return 410;
    case "REGION_RESTRICTED":
      return 451;
    case "RATE_LIMITED":
      return 429;
    case "UPSTREAM_TIMEOUT":
      return 504;
    case "UPSTREAM_UNAVAILABLE":
    case "NETWORK_ERROR":
      return 502;
    case "UNKNOWN_ERROR":
      return 500;
  }
}

function catalogStatusForError(code: AppErrorCode): number {
  return code === "TRACK_UNAVAILABLE" ? 404 : statusForError(code);
}

async function withTimeout<T>(
  execute: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const timeoutResult = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => {
      reject(new AppError(
        "UPSTREAM_TIMEOUT",
        "上游响应超时，请稍后重试。",
        { retryable: true },
      ));
    }, { once: true });
  });

  try {
    return await Promise.race([execute(controller.signal), timeoutResult]);
  } catch (error) {
    if (timedOut) {
      throw new AppError(
        "UPSTREAM_TIMEOUT",
        "上游响应超时，请稍后重试。",
        { retryable: true },
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function executeRead<T>(options: ReadRouteOptions<T>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await withTimeout(options.execute, options.timeoutMs);
    } catch (error) {
      const appError = toAppError(error);
      if (attempt === 1 || !isRetryableReadError(appError)) {
        throw appError;
      }
      const delayMs = 100 + Math.floor(options.dependencies.random() * 201);
      await options.dependencies.retryDelay(delayMs);
    }
  }

  throw new AppError("UNKNOWN_ERROR", "请求未能完成，请稍后重试。");
}

function jsonResponse<T>(
  body: ApiResult<T>,
  status: number,
  cacheControl: string,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": cacheControl,
      "X-Request-Id": body.ok ? body.meta?.requestId ?? "" : body.error.requestId,
    },
  });
}

async function respondToRead<T>(options: ReadRouteOptions<T>): Promise<Response> {
  try {
    const data = await executeRead(options);
    return jsonResponse(createApiSuccess(data, {
      requestId: options.requestId,
      mode: "real",
      fetchedAt: new Date(options.dependencies.now()).toISOString(),
    }), 200, options.cacheControl);
  } catch (error) {
    const appError = toAppError(error);
    return jsonResponse(
      createApiFailure(appError, options.requestId),
      options.statusForError?.(appError.code) ?? statusForError(appError.code),
      noStoreCacheControl,
    );
  }
}

function resolveDependencies(
  dependencies: PublicReadRouteDependencies,
): ResolvedDependencies {
  return {
    createProvider: dependencies.createProvider,
    createRequestId: dependencies.createRequestId ?? randomUUID,
    now: dependencies.now ?? Date.now,
    retryDelay: dependencies.retryDelay ?? defaultRetryDelay,
    random: dependencies.random ?? Math.random,
    resolvePlaybackCredential: dependencies.resolvePlaybackCredential ?? (() => undefined),
    timeoutMs: dependencies.timeoutMs ?? {
      default: 10_000,
      source: 15_000,
    },
  };
}

function resolveCatalogDependencies(
  dependencies: CatalogReadRouteDependencies,
): ResolvedCatalogDependencies {
  return {
    createProvider: dependencies.createProvider,
    createRequestId: dependencies.createRequestId ?? randomUUID,
    now: dependencies.now ?? Date.now,
    retryDelay: dependencies.retryDelay ?? defaultRetryDelay,
    random: dependencies.random ?? Math.random,
    timeoutMs: dependencies.timeoutMs ?? 10_000,
  };
}

function getPlaybackSource(
  provider: PublicReadProvider,
  trackId: string,
  quality: AudioQuality,
  upstreamCookie: string | undefined,
): Promise<PlaybackSource> {
  return upstreamCookie
    ? provider.getPlaybackSource(trackId, quality, upstreamCookie)
    : provider.getPlaybackSource(trackId, quality);
}

export function createPublicReadRouteHandlers(
  inputDependencies: PublicReadRouteDependencies,
): PublicReadRouteHandlers {
  const dependencies = resolveDependencies(inputDependencies);

  return {
    async search(request) {
      const requestId = dependencies.createRequestId();
      try {
        const query = parseSearchQuery(request);
        return await respondToRead({
          cacheControl: publicMetadataCacheControl,
          requestId,
          timeoutMs: dependencies.timeoutMs.default,
          dependencies,
          execute: () => dependencies.createProvider().search(query),
        });
      } catch (error) {
        const appError = toAppError(error);
        return jsonResponse(
          createApiFailure(appError, requestId),
          statusForError(appError.code),
          noStoreCacheControl,
        );
      }
    },

    async track(_request, trackId) {
      const requestId = dependencies.createRequestId();
      try {
        const id = parseTrackId(trackId);
        return await respondToRead({
          cacheControl: publicMetadataCacheControl,
          requestId,
          timeoutMs: dependencies.timeoutMs.default,
          dependencies,
          execute: () => dependencies.createProvider().getTrack(id),
        });
      } catch (error) {
        const appError = toAppError(error);
        return jsonResponse(
          createApiFailure(appError, requestId),
          statusForError(appError.code),
          noStoreCacheControl,
        );
      }
    },

    async source(request, trackId) {
      const requestId = dependencies.createRequestId();
      try {
        const id = parseTrackId(trackId);
        const quality = parseAudioQuality(request);
        const upstreamCookie = dependencies.resolvePlaybackCredential(request);
        return await respondToRead({
          cacheControl: noStoreCacheControl,
          requestId,
          timeoutMs: dependencies.timeoutMs.source,
          dependencies,
          execute: () => getPlaybackSource(
            dependencies.createProvider(),
            id,
            quality,
            upstreamCookie,
          ),
        });
      } catch (error) {
        const appError = toAppError(error);
        return jsonResponse(
          createApiFailure(appError, requestId),
          statusForError(appError.code),
          noStoreCacheControl,
        );
      }
    },

    async availability(request, trackId) {
      const requestId = dependencies.createRequestId();
      try {
        const id = parseTrackId(trackId);
        const upstreamCookie = dependencies.resolvePlaybackCredential(request);
        return await respondToRead<PlaybackAvailability>({
          cacheControl: noStoreCacheControl,
          requestId,
          timeoutMs: dependencies.timeoutMs.source,
          dependencies,
          execute: async () => {
            try {
              await getPlaybackSource(
                dependencies.createProvider(),
                id,
                "standard",
                upstreamCookie,
              );
              return { state: "verified-playable" };
            } catch (error) {
              const appError = toAppError(error);
              if (
                appError.code === "TRACK_UNAVAILABLE"
                || appError.code === "VIP_REQUIRED"
                || appError.code === "REGION_RESTRICTED"
              ) {
                return { state: "unavailable" };
              }
              throw appError;
            }
          },
        });
      } catch (error) {
        const appError = toAppError(error);
        return jsonResponse(
          createApiFailure(appError, requestId),
          statusForError(appError.code),
          noStoreCacheControl,
        );
      }
    },

    async lyrics(_request, trackId) {
      const requestId = dependencies.createRequestId();
      try {
        const id = parseTrackId(trackId);
        return await respondToRead({
          cacheControl: publicMetadataCacheControl,
          requestId,
          timeoutMs: dependencies.timeoutMs.default,
          dependencies,
          execute: () => dependencies.createProvider().getLyrics(id),
        });
      } catch (error) {
        const appError = toAppError(error);
        return jsonResponse(
          createApiFailure(appError, requestId),
          statusForError(appError.code),
          noStoreCacheControl,
        );
      }
    },

    async comments(request, trackId) {
      const requestId = dependencies.createRequestId();
      try {
        const id = parseTrackId(trackId);
        const page = parseCommentsPage(request);
        return await respondToRead({
          cacheControl: commentCacheControl,
          requestId,
          timeoutMs: dependencies.timeoutMs.default,
          dependencies,
          execute: () => dependencies.createProvider().getComments(id, page),
        });
      } catch (error) {
        const appError = toAppError(error);
        return jsonResponse(
          createApiFailure(appError, requestId),
          statusForError(appError.code),
          noStoreCacheControl,
        );
      }
    },
  };
}

export function createCatalogReadRouteHandlers(
  inputDependencies: CatalogReadRouteDependencies,
): CatalogReadRouteHandlers {
  const dependencies = resolveCatalogDependencies(inputDependencies);

  const failure = (error: unknown, requestId: string): Response => {
    const appError = toAppError(error);
    return jsonResponse(
      createApiFailure(appError, requestId),
      catalogStatusForError(appError.code),
      noStoreCacheControl,
    );
  };

  return {
    async album(_request, albumId) {
      const requestId = dependencies.createRequestId();
      try {
        const id = parseCatalogId(albumId, "专辑");
        return await respondToRead({
          cacheControl: publicMetadataCacheControl,
          requestId,
          timeoutMs: dependencies.timeoutMs,
          dependencies,
          statusForError: catalogStatusForError,
          execute: () => dependencies.createProvider().getAlbum(id),
        });
      } catch (error) {
        return failure(error, requestId);
      }
    },

    async artist(request, artistId) {
      const requestId = dependencies.createRequestId();
      try {
        const id = parseCatalogId(artistId, "歌手");
        const page = parseCatalogPage(request, 20);
        return await respondToRead({
          cacheControl: publicMetadataCacheControl,
          requestId,
          timeoutMs: dependencies.timeoutMs,
          dependencies,
          statusForError: catalogStatusForError,
          execute: () => dependencies.createProvider().getArtist(id, page),
        });
      } catch (error) {
        return failure(error, requestId);
      }
    },

    async newSongs(request) {
      const requestId = dependencies.createRequestId();
      try {
        const limit = parseNewSongLimit(request);
        return await respondToRead({
          cacheControl: publicMetadataCacheControl,
          requestId,
          timeoutMs: dependencies.timeoutMs,
          dependencies,
          execute: () => dependencies.createProvider().getNewSongs(limit),
        });
      } catch (error) {
        return failure(error, requestId);
      }
    },

    async popularPlaylists(request) {
      const requestId = dependencies.createRequestId();
      try {
        const page = parseCatalogPage(request, 8);
        return await respondToRead({
          cacheControl: publicMetadataCacheControl,
          requestId,
          timeoutMs: dependencies.timeoutMs,
          dependencies,
          execute: () => dependencies.createProvider().getPopularPlaylists(page),
        });
      } catch (error) {
        return failure(error, requestId);
      }
    },
  };
}
