import { randomUUID } from "node:crypto";

import {
  createApiFailure,
  createApiSuccess,
  type ApiResult,
} from "./apiResult";
import { AppError, isAppError, type AppErrorCode } from "./errors";
import type {
  PageQuery,
  UserPlaylistCollection,
  UserProfile,
  UserProfileOverview,
} from "./models";

const userIdPattern = /^\d{1,20}$/;
const noStoreCacheControl = "no-store";

export interface ProfileReadProvider {
  getUserProfile(userId: string, upstreamCookie?: string): Promise<UserProfile>;
  getUserPlaylists(
    userId: string,
    page: PageQuery,
    upstreamCookie?: string,
  ): Promise<UserPlaylistCollection>;
}

export interface ProfileReadContext {
  currentUser: UserProfile | null;
  upstreamCookie?: string;
}

export interface ProfileReadRouteHandlers {
  profile(request: Request, userId: string): Promise<Response>;
  playlists(request: Request, userId: string): Promise<Response>;
}

export interface ProfileReadRouteDependencies {
  createProvider: () => ProfileReadProvider;
  createRequestId?: () => string;
  now?: () => number;
  random?: () => number;
  resolveContext?: (request: Request) => ProfileReadContext;
  retryDelay?: (delayMs: number) => Promise<void>;
  timeoutMs?: number;
}

interface ResolvedDependencies {
  createProvider: () => ProfileReadProvider;
  createRequestId: () => string;
  now: () => number;
  random: () => number;
  resolveContext: (request: Request) => ProfileReadContext;
  retryDelay: (delayMs: number) => Promise<void>;
  timeoutMs: number;
}

function defaultRetryDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }
  return new AppError("UNKNOWN_ERROR", "请求未能完成，请稍后重试。", { retryable: true });
}

function validationError(message: string): AppError {
  return new AppError("VALIDATION_ERROR", message, { retryable: false });
}

function parseUserId(value: string): string {
  const userId = value.trim();
  if (!userIdPattern.test(userId)) {
    throw validationError("用户 ID 格式无效。");
  }
  return userId;
}

function parsePage(request: Request): PageQuery {
  const params = new URL(request.url).searchParams;
  const values = [
    [params.get("limit"), 30, 30, "limit"],
    [params.get("offset"), 0, Number.MAX_SAFE_INTEGER, "offset"],
  ] as const;
  const parsed = values.map(([value, fallback, maximum, name]) => {
    if (value === null) {
      return fallback;
    }
    if (!/^\d+$/.test(value)) {
      throw validationError(`${name} 必须是整数。`);
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number > maximum) {
      throw validationError(`${name} 超出允许范围。`);
    }
    return number;
  });
  if (parsed[0] < 1) {
    throw validationError("limit 必须大于零。");
  }
  return { limit: parsed[0], offset: parsed[1] };
}

function isRetryableReadError(error: AppError): boolean {
  return error.code === "RATE_LIMITED"
    || error.code === "UPSTREAM_TIMEOUT"
    || error.code === "NETWORK_ERROR";
}

async function withTimeout<T>(execute: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new AppError("UPSTREAM_TIMEOUT", "上游响应超时，请稍后重试。", {
        retryable: true,
      }));
    }, timeoutMs);
  });

  try {
    return await Promise.race([execute(), timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function executeRead<T>(
  execute: () => Promise<T>,
  dependencies: ResolvedDependencies,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await withTimeout(execute, dependencies.timeoutMs);
    } catch (error) {
      const appError = toAppError(error);
      if (attempt === 1 || !isRetryableReadError(appError)) {
        throw appError;
      }
      await dependencies.retryDelay(100 + Math.floor(dependencies.random() * 201));
    }
  }
  throw new AppError("UNKNOWN_ERROR", "请求未能完成，请稍后重试。", { retryable: true });
}

function statusForError(code: AppErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "AUTH_REQUIRED":
    case "SESSION_EXPIRED":
      return 401;
    case "USER_NOT_FOUND":
      return 404;
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

function respond<T>(body: ApiResult<T>, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": noStoreCacheControl,
      "X-Request-Id": body.ok ? body.meta?.requestId ?? "" : body.error.requestId,
    },
  });
}

function resolveDependencies(
  input: ProfileReadRouteDependencies,
): ResolvedDependencies {
  return {
    createProvider: input.createProvider,
    createRequestId: input.createRequestId ?? randomUUID,
    now: input.now ?? Date.now,
    random: input.random ?? Math.random,
    resolveContext: input.resolveContext ?? (() => ({ currentUser: null })),
    retryDelay: input.retryDelay ?? defaultRetryDelay,
    timeoutMs: input.timeoutMs ?? 10_000,
  };
}

function publicCollection(
  collection: UserPlaylistCollection,
  isCurrentUser: boolean,
): UserPlaylistCollection {
  if (isCurrentUser) {
    return collection;
  }
  const publicPlaylist = (playlist: UserPlaylistCollection["liked"]) => (
    playlist?.visibility === "public" ? playlist : null
  );
  return {
    liked: publicPlaylist(collection.liked),
    created: collection.created.filter((playlist) => playlist.visibility === "public"),
    subscribed: collection.subscribed.filter((playlist) => playlist.visibility === "public"),
  };
}

export function createProfileReadRouteHandlers(
  inputDependencies: ProfileReadRouteDependencies,
): ProfileReadRouteHandlers {
  const dependencies = resolveDependencies(inputDependencies);

  const failure = (error: unknown, requestId: string): Response => {
    const appError = toAppError(error);
    return respond(createApiFailure(appError, requestId), statusForError(appError.code));
  };

  return {
    async profile(request, rawUserId) {
      const requestId = dependencies.createRequestId();
      try {
        const userId = parseUserId(rawUserId);
        const context = dependencies.resolveContext(request);
        const profile = await executeRead(
          () => dependencies.createProvider().getUserProfile(userId, context.upstreamCookie),
          dependencies,
        );
        const data: UserProfileOverview = {
          profile,
          isCurrentUser: context.currentUser?.id === profile.id,
          recentPlays: { state: "unavailable", reason: "upstream-not-verified" },
        };
        return respond(createApiSuccess(data, {
          requestId,
          mode: "real",
          fetchedAt: new Date(dependencies.now()).toISOString(),
        }), 200);
      } catch (error) {
        return failure(error, requestId);
      }
    },

    async playlists(request, rawUserId) {
      const requestId = dependencies.createRequestId();
      try {
        const userId = parseUserId(rawUserId);
        const page = parsePage(request);
        const context = dependencies.resolveContext(request);
        const isCurrentUser = context.currentUser?.id === userId;
        const collection = await executeRead(
          () => dependencies.createProvider().getUserPlaylists(
            userId,
            page,
            context.upstreamCookie,
          ),
          dependencies,
        );
        return respond(createApiSuccess(publicCollection(collection, isCurrentUser), {
          requestId,
          mode: "real",
          fetchedAt: new Date(dependencies.now()).toISOString(),
        }), 200);
      } catch (error) {
        return failure(error, requestId);
      }
    },
  };
}
