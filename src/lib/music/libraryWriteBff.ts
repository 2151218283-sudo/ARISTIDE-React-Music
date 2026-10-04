import { randomUUID } from "node:crypto";

import {
  createApiFailure,
  createApiSuccess,
  type ApiResult,
} from "./apiResult";
import { AppError, isAppError, type AppErrorCode } from "./errors";
import type {
  AlbumSummary,
  CatalogPage,
  LibraryMutationKind,
  LibraryMutationResult,
  PageQuery,
  Track,
} from "./models";
import {
  InMemorySessionStore,
  SESSION_COOKIE_NAME,
  type ServerSession,
} from "../session/sessionStore";

const noStoreCacheControl = "no-store";
const entityIdPattern = /^\d{1,20}$/;
const demoEntityIdPattern = /^demo-[A-Za-z0-9_-]{1,64}$/;
const mutationIdPattern = /^[A-Za-z0-9_-]{16,128}$/;

export interface LibraryWriteProvider {
  getLikedTracks(
    userId: string,
    page: PageQuery,
    credential: string,
  ): Promise<CatalogPage<Track>>;
  getSavedAlbums(
    page: PageQuery,
    credential: string,
  ): Promise<CatalogPage<AlbumSummary>>;
  setTrackLiked(trackId: string, liked: boolean, credential: string): Promise<void>;
  setAlbumCollected(albumId: string, collected: boolean, credential: string): Promise<void>;
}

export interface LibraryWriteRouteHandlers {
  likes(request: Request): Promise<Response>;
  albums(request: Request): Promise<Response>;
  like(request: Request, trackId: string, liked: boolean): Promise<Response>;
  album(request: Request, albumId: string, collected: boolean): Promise<Response>;
}

export interface LibraryWriteRouteDependencies {
  store: InMemorySessionStore;
  createRealProvider: () => LibraryWriteProvider;
  createDemoProvider: () => LibraryWriteProvider;
  createRequestId?: () => string;
  now?: () => number;
  timeoutMs?: number;
}

interface ResolvedDependencies {
  store: InMemorySessionStore;
  createRealProvider: () => LibraryWriteProvider;
  createDemoProvider: () => LibraryWriteProvider;
  createRequestId: () => string;
  now: () => number;
  timeoutMs: number;
}

interface SessionContext {
  mode: "real" | "demo";
  provider: LibraryWriteProvider;
  session: ServerSession;
  userId: string;
  credential: string;
}

function parseSessionId(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) {
      return value.join("=") || null;
    }
  }
  return null;
}

function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }
  return new AppError("UNKNOWN_ERROR", "请求未能完成，请稍后重试。", { retryable: true });
}

function statusForError(code: AppErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "AUTH_REQUIRED":
    case "SESSION_EXPIRED":
      return 401;
    case "TRACK_UNAVAILABLE":
    case "SOURCE_EXPIRED":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "UPSTREAM_TIMEOUT":
      return 504;
    case "UPSTREAM_UNAVAILABLE":
    case "NETWORK_ERROR":
      return 502;
    case "USER_NOT_FOUND":
      return 404;
    case "VIP_REQUIRED":
      return 403;
    case "REGION_RESTRICTED":
      return 451;
    case "QR_EXPIRED":
      return 410;
    case "UNKNOWN_ERROR":
      return 500;
  }
}

function response<T>(body: ApiResult<T>, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": noStoreCacheControl,
      "X-Request-Id": body.ok ? body.meta?.requestId ?? "" : body.error.requestId,
    },
  });
}

function success<T>(
  data: T,
  requestId: string,
  mode: "real" | "demo",
  now: () => number,
): Response {
  return response(createApiSuccess(data, {
    requestId,
    mode,
    fetchedAt: new Date(now()).toISOString(),
  }), 200);
}

function parseEntityId(value: string, label: string, mode: "real" | "demo"): string {
  const normalized = value.trim();
  const validRealId = entityIdPattern.test(normalized);
  const validDemoId = mode === "demo" && demoEntityIdPattern.test(normalized);
  if (!validRealId && !validDemoId) {
    throw new AppError("VALIDATION_ERROR", `${label} ID 格式无效。`, { retryable: false });
  }
  return normalized;
}

function parsePage(request: Request): PageQuery {
  const params = new URL(request.url).searchParams;
  const read = (name: string, fallback: number): number => {
    const value = params.get(name);
    if (value === null) {
      return fallback;
    }
    if (!/^\d+$/.test(value)) {
      throw new AppError("VALIDATION_ERROR", `${name} 必须是整数。`, { retryable: false });
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > Number.MAX_SAFE_INTEGER) {
      throw new AppError("VALIDATION_ERROR", `${name} 超出允许范围。`, { retryable: false });
    }
    return number;
  };
  const limit = read("limit", 50);
  if (limit < 1 || limit > 50) {
    throw new AppError("VALIDATION_ERROR", "limit 必须是 1 至 50 的整数。", { retryable: false });
  }
  return { limit, offset: read("offset", 0) };
}

async function parseMutationId(request: Request): Promise<string> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "写入参数无效。", { retryable: false });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("VALIDATION_ERROR", "写入参数无效。", { retryable: false });
  }
  const clientMutationId = (body as { clientMutationId?: unknown }).clientMutationId;
  if (typeof clientMutationId !== "string" || !mutationIdPattern.test(clientMutationId)) {
    throw new AppError("VALIDATION_ERROR", "clientMutationId 格式无效。", { retryable: false });
  }
  return clientMutationId;
}

async function withTimeout<T>(execute: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new AppError(
      "UPSTREAM_TIMEOUT",
      "上游响应超时，请稍后重试。",
      { retryable: true },
    )), timeoutMs);
  });
  try {
    return await Promise.race([execute(), timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function resolveDependencies(input: LibraryWriteRouteDependencies): ResolvedDependencies {
  return {
    store: input.store,
    createRealProvider: input.createRealProvider,
    createDemoProvider: input.createDemoProvider,
    createRequestId: input.createRequestId ?? randomUUID,
    now: input.now ?? Date.now,
    timeoutMs: input.timeoutMs ?? 15_000,
  };
}

function resolveContext(
  request: Request,
  dependencies: ResolvedDependencies,
): SessionContext {
  const sessionId = parseSessionId(request);
  const session = sessionId ? dependencies.store.get(sessionId) : null;
  if (!session) {
    throw new AppError("AUTH_REQUIRED", "请先完成扫码登录。", { retryable: false });
  }
  if (session.mode === "demo") {
    return {
      mode: "demo",
      provider: dependencies.createDemoProvider(),
      session,
      userId: session.user?.id ?? "demo",
      credential: session.id,
    };
  }
  if (!session.user || !session.upstreamCookie) {
    throw new AppError("AUTH_REQUIRED", "请先完成扫码登录。", { retryable: false });
  }
  return {
    mode: "real",
    provider: dependencies.createRealProvider(),
    session,
    userId: session.user.id,
    credential: session.upstreamCookie,
  };
}

function mutationResult(
  kind: LibraryMutationKind,
  id: string,
  active: boolean,
): LibraryMutationResult {
  return { kind, id, active };
}

async function runMutation(
  context: SessionContext,
  dependencies: ResolvedDependencies,
  request: Request,
  requestId: string,
  operation: string,
  id: string,
  kind: LibraryMutationKind,
  active: boolean,
  execute: () => Promise<void>,
): Promise<Response> {
  const clientMutationId = await parseMutationId(request);
  const existing = dependencies.store.getLibraryMutation(context.session.id, clientMutationId);
  if (existing) {
    if (existing.operation !== operation) {
      throw new AppError("VALIDATION_ERROR", "clientMutationId 已用于其他写操作。", {
        retryable: false,
      });
    }
    return success(existing.result as LibraryMutationResult, requestId, context.mode, dependencies.now);
  }

  // Writes intentionally have no retry loop. The caller can retry deliberately
  // with a new mutation ID after the inline error is understood.
  await withTimeout(execute, dependencies.timeoutMs);
  const result = mutationResult(kind, id, active);
  if (!dependencies.store.setLibraryMutation(
    context.session.id,
    clientMutationId,
    operation,
    result,
  )) {
    throw new AppError("SESSION_EXPIRED", "登录状态已失效，请重新扫码。", { retryable: false });
  }
  return success(result, requestId, context.mode, dependencies.now);
}

export function createLibraryWriteRouteHandlers(
  inputDependencies: LibraryWriteRouteDependencies,
): LibraryWriteRouteHandlers {
  const dependencies = resolveDependencies(inputDependencies);

  return {
    async likes(request) {
      const requestId = dependencies.createRequestId();
      try {
        const context = resolveContext(request, dependencies);
        const page = parsePage(request);
        const data = await withTimeout(
          () => context.provider.getLikedTracks(context.userId, page, context.credential),
          dependencies.timeoutMs,
        );
        return success(data, requestId, context.mode, dependencies.now);
      } catch (error) {
        return failureResponse(error, requestId);
      }
    },

    async albums(request) {
      const requestId = dependencies.createRequestId();
      try {
        const context = resolveContext(request, dependencies);
        const page = parsePage(request);
        const data = await withTimeout(
          () => context.provider.getSavedAlbums(page, context.credential),
          dependencies.timeoutMs,
        );
        return success(data, requestId, context.mode, dependencies.now);
      } catch (error) {
        return failureResponse(error, requestId);
      }
    },

    async like(request, rawTrackId, liked) {
      const requestId = dependencies.createRequestId();
      try {
        const context = resolveContext(request, dependencies);
        const trackId = parseEntityId(rawTrackId, "歌曲", context.mode);
        return await runMutation(
          context,
          dependencies,
          request,
          requestId,
          `track-like:${trackId}:${liked ? "put" : "delete"}`,
          trackId,
          "track-like",
          liked,
          () => context.provider.setTrackLiked(trackId, liked, context.credential),
        );
      } catch (error) {
        return failureResponse(error, requestId);
      }
    },

    async album(request, rawAlbumId, collected) {
      const requestId = dependencies.createRequestId();
      try {
        const context = resolveContext(request, dependencies);
        const albumId = parseEntityId(rawAlbumId, "专辑", context.mode);
        return await runMutation(
          context,
          dependencies,
          request,
          requestId,
          `album-collection:${albumId}:${collected ? "put" : "delete"}`,
          albumId,
          "album-collection",
          collected,
          () => context.provider.setAlbumCollected(albumId, collected, context.credential),
        );
      } catch (error) {
        return failureResponse(error, requestId);
      }
    },
  };
}

function failureResponse(error: unknown, requestId: string): Response {
  const appError = toAppError(error);
  return response(createApiFailure(appError, requestId), statusForError(appError.code));
}
