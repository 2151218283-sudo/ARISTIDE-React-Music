import { randomUUID } from "node:crypto";

import {
  createApiFailure,
  createApiSuccess,
  type ApiResult,
} from "./apiResult";
import { AppError, isAppError, type AppErrorCode } from "./errors";
import type {
  DailyRecommendations,
  DataMode,
  Track,
  UserProfile,
} from "./models";
import {
  InMemorySessionStore,
  SESSION_COOKIE_NAME,
  type PublicSessionState,
  type ServerSession,
} from "../session/sessionStore";

const noStoreCacheControl = "no-store";

export interface DailyRecommendationRealProvider {
  getSessionUser(upstreamCookie: string): Promise<UserProfile | null>;
  getPersonalDailyRecommendations(upstreamCookie: string): Promise<Track[]>;
  getVerifiedPublicRecommendations(): Promise<Track[]>;
}

export interface DailyRecommendationDemoProvider {
  getDailyRecommendations(sessionId: string): Promise<Track[]>;
}

export interface DailyRecommendationRouteHandlers {
  daily(request: Request): Promise<Response>;
  setMode(request: Request): Promise<Response>;
}

export interface DailyRecommendationRouteDependencies {
  createDemoProvider: () => DailyRecommendationDemoProvider;
  createRealProvider: () => DailyRecommendationRealProvider;
  createRequestId?: () => string;
  now?: () => number;
  random?: () => number;
  retryDelay?: (delayMs: number) => Promise<void>;
  store: InMemorySessionStore;
  timeoutMs?: number;
}

interface ResolvedDependencies {
  createDemoProvider: () => DailyRecommendationDemoProvider;
  createRealProvider: () => DailyRecommendationRealProvider;
  createRequestId: () => string;
  now: () => number;
  random: () => number;
  retryDelay: (delayMs: number) => Promise<void>;
  store: InMemorySessionStore;
  timeoutMs: number;
}

function defaultRetryDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function resolveDependencies(
  input: DailyRecommendationRouteDependencies,
): ResolvedDependencies {
  return {
    createDemoProvider: input.createDemoProvider,
    createRealProvider: input.createRealProvider,
    createRequestId: input.createRequestId ?? randomUUID,
    now: input.now ?? Date.now,
    random: input.random ?? Math.random,
    retryDelay: input.retryDelay ?? defaultRetryDelay,
    store: input.store,
    timeoutMs: input.timeoutMs ?? 10_000,
  };
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

function parseCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      return rawValue.join("=") || null;
    }
  }
  return null;
}

function shouldSecureCookie(request: Request): boolean {
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  return forwardedProtocol === "https" || new URL(request.url).protocol === "https:";
}

function sessionCookie(request: Request, sessionId: string): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${sessionId}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (shouldSecureCookie(request)) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

function jsonResponse<T>(
  body: ApiResult<T>,
  status: number,
  setCookie?: string,
): Response {
  const headers = new Headers({
    "Cache-Control": noStoreCacheControl,
    "X-Request-Id": body.ok ? body.meta?.requestId ?? "" : body.error.requestId,
  });
  if (setCookie) {
    headers.set("Set-Cookie", setCookie);
  }
  return Response.json(body, { status, headers });
}

function localDate(now: number): string {
  const date = new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isRetryableReadError(error: AppError): boolean {
  return error.code === "RATE_LIMITED"
    || error.code === "UPSTREAM_TIMEOUT"
    || error.code === "NETWORK_ERROR";
}

async function withTimeout<T>(
  execute: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new AppError(
        "UPSTREAM_TIMEOUT",
        "上游响应超时，请稍后重试。",
        { retryable: true },
      ));
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
      const delayMs = 100 + Math.floor(dependencies.random() * 201);
      await dependencies.retryDelay(delayMs);
    }
  }

  throw new AppError("UNKNOWN_ERROR", "请求未能完成，请稍后重试。", {
    retryable: true,
  });
}

function recommendationCacheKey(
  session: ServerSession,
  date: string,
): string {
  if (session.mode === "demo") {
    return `demo:${session.id}:${date}`;
  }
  if (session.user && session.upstreamCookie) {
    return `personal:${session.user.id}:${date}`;
  }
  return `public:${session.id}:${date}`;
}

function publicRecommendationCacheKey(date: string): string {
  return `public:bare:${date}`;
}

async function getVerifiedPublicRecommendations(
  date: string,
  dependencies: ResolvedDependencies,
): Promise<DailyRecommendations> {
  const cacheKey = publicRecommendationCacheKey(date);
  const cached = dependencies.store.getPublicDailyRecommendations(cacheKey);
  if (cached) {
    return cached;
  }

  const tracks = await executeRead(
    () => dependencies.createRealProvider().getVerifiedPublicRecommendations(),
    dependencies,
  );
  const result: DailyRecommendations = { date, source: "public", tracks };
  if (tracks.length > 0) {
    dependencies.store.setPublicDailyRecommendations(cacheKey, result);
  }
  return result;
}

async function getDailyRecommendations(
  session: ServerSession,
  date: string,
  dependencies: ResolvedDependencies,
): Promise<DailyRecommendations> {
  const cacheKey = recommendationCacheKey(session, date);
  const cached = dependencies.store.getDailyRecommendations(session.id, cacheKey);
  if (cached) {
    return cached;
  }

  let result: DailyRecommendations;
  if (session.mode === "demo") {
    const tracks = await executeRead(
      () => dependencies.createDemoProvider().getDailyRecommendations(session.id),
      dependencies,
    );
    result = { date, source: "demo", tracks };
  } else if (session.user && session.upstreamCookie) {
    const realProvider = dependencies.createRealProvider();
    const personalTracks = await executeRead(
      () => realProvider.getPersonalDailyRecommendations(session.upstreamCookie ?? ""),
      dependencies,
    );
    result = personalTracks.length > 0
      ? { date, source: "personal", tracks: personalTracks }
      : await getVerifiedPublicRecommendations(date, dependencies);
  } else {
    result = await getVerifiedPublicRecommendations(date, dependencies);
  }

  if (result.source === "demo" || result.tracks.length > 0) {
    dependencies.store.setDailyRecommendations(session.id, cacheKey, result);
  }
  return result;
}

function success<T>(
  data: T,
  requestId: string,
  mode: DataMode,
  now: () => number,
  setCookie?: string,
): Response {
  return jsonResponse(createApiSuccess(data, {
    requestId,
    mode,
    fetchedAt: new Date(now()).toISOString(),
  }), 200, setCookie);
}

function failure(
  error: unknown,
  requestId: string,
  setCookie?: string,
): Response {
  const appError = toAppError(error);
  return jsonResponse(
    createApiFailure(appError, requestId),
    statusForError(appError.code),
    setCookie,
  );
}

async function parseDataMode(request: Request): Promise<DataMode> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "数据模式参数无效。", {
      retryable: false,
    });
  }
  if (
    typeof body !== "object"
    || body === null
    || Array.isArray(body)
    || !["real", "demo"].includes((body as { mode?: unknown }).mode as string)
  ) {
    throw new AppError("VALIDATION_ERROR", "数据模式参数无效。", {
      retryable: false,
    });
  }
  return (body as { mode: DataMode }).mode;
}

export function createDailyRecommendationRouteHandlers(
  inputDependencies: DailyRecommendationRouteDependencies,
): DailyRecommendationRouteHandlers {
  const dependencies = resolveDependencies(inputDependencies);

  return {
    async daily(request) {
      const requestId = dependencies.createRequestId();
      const resolved = dependencies.store.resolve(
        parseCookie(request, SESSION_COOKIE_NAME),
      );
      const setCookie = resolved.created
        ? sessionCookie(request, resolved.session.id)
        : undefined;

      try {
        const data = await getDailyRecommendations(
          resolved.session,
          localDate(dependencies.now()),
          dependencies,
        );
        return success(data, requestId, resolved.session.mode, dependencies.now, setCookie);
      } catch (error) {
        return failure(error, requestId, setCookie);
      }
    },

    async setMode(request) {
      const requestId = dependencies.createRequestId();
      const resolved = dependencies.store.resolve(
        parseCookie(request, SESSION_COOKIE_NAME),
      );
      const setCookie = resolved.created
        ? sessionCookie(request, resolved.session.id)
        : undefined;

      try {
        const mode = await parseDataMode(request);
        if (
          mode === "real"
          && resolved.session.mode === "demo"
          && resolved.session.upstreamCookie
        ) {
          const user = await executeRead(
            () => dependencies.createRealProvider().getSessionUser(
              resolved.session.upstreamCookie ?? "",
            ),
            dependencies,
          );
          if (user) {
            dependencies.store.setAuthenticatedUser(resolved.session.id, user);
          } else {
            dependencies.store.clearAuthentication(resolved.session.id);
          }
        }
        if (!dependencies.store.setMode(resolved.session.id, mode)) {
          throw new AppError("SESSION_EXPIRED", "会话已失效，请刷新后重试。", {
            retryable: false,
          });
        }
        const state: PublicSessionState | null = dependencies.store.getPublicState(
          resolved.session.id,
        );
        if (!state) {
          throw new AppError("SESSION_EXPIRED", "会话已失效，请刷新后重试。", {
            retryable: false,
          });
        }
        return success(state, requestId, state.mode, dependencies.now, setCookie);
      } catch (error) {
        return failure(error, requestId, setCookie);
      }
    },
  };
}
