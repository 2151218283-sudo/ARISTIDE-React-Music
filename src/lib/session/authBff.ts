import { randomUUID } from "node:crypto";

import {
  createApiFailure,
  createApiSuccess,
  type ApiResult,
} from "@/lib/music/apiResult";
import { AppError, isAppError, type AppErrorCode } from "@/lib/music/errors";

import {
  SessionAuthService,
  type SessionAuthUpstream,
  type SessionStateResponse,
  type StartQrLoginResponse,
} from "./authService";
import {
  InMemorySessionStore,
  SESSION_COOKIE_NAME,
} from "./sessionStore";

const noStoreCacheControl = "no-store";

export interface AuthRouteHandlers {
  session(request: Request): Promise<Response>;
  startQr(request: Request): Promise<Response>;
  qrStatus(request: Request): Promise<Response>;
  logout(request: Request): Promise<Response>;
}

export interface AuthRouteDependencies {
  store: InMemorySessionStore;
  createUpstream: () => SessionAuthUpstream;
  createRequestId?: () => string;
  now?: () => number;
  timeoutMs?: number;
}

interface ResolvedDependencies {
  store: InMemorySessionStore;
  createUpstream: () => SessionAuthUpstream;
  createRequestId: () => string;
  now: () => number;
  timeoutMs: number;
}

function resolveDependencies(input: AuthRouteDependencies): ResolvedDependencies {
  return {
    store: input.store,
    createUpstream: input.createUpstream,
    createRequestId: input.createRequestId ?? randomUUID,
    now: input.now ?? Date.now,
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
    case "QR_EXPIRED":
      return 410;
    case "RATE_LIMITED":
      return 429;
    case "UPSTREAM_TIMEOUT":
      return 504;
    case "UPSTREAM_UNAVAILABLE":
    case "NETWORK_ERROR":
      return 502;
    case "TRACK_UNAVAILABLE":
    case "SOURCE_EXPIRED":
      return 409;
    case "VIP_REQUIRED":
      return 403;
    case "REGION_RESTRICTED":
      return 451;
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

function expiredSessionCookie(request: Request): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
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

function createService(dependencies: ResolvedDependencies): SessionAuthService {
  return new SessionAuthService(dependencies.store, dependencies.createUpstream());
}

function success<T>(
  data: T,
  requestId: string,
  now: () => number,
  setCookie?: string,
): Response {
  return jsonResponse(createApiSuccess(data, {
    requestId,
    mode: "real",
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

function getChallengeId(request: Request): string | null {
  const candidate = new URL(request.url).searchParams.get("challengeId");
  return candidate && /^[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : null;
}

export function createAuthRouteHandlers(
  inputDependencies: AuthRouteDependencies,
): AuthRouteHandlers {
  const dependencies = resolveDependencies(inputDependencies);

  return {
    async session(request) {
      const requestId = dependencies.createRequestId();
      const service = createService(dependencies);
      const resolved = service.resolveSession(
        parseCookie(request, SESSION_COOKIE_NAME),
      );
      try {
        const data: SessionStateResponse = service.getSessionState(resolved.session.id);
        return success(
          data,
          requestId,
          dependencies.now,
          resolved.created ? sessionCookie(request, resolved.session.id) : undefined,
        );
      } catch (error) {
        return failure(error, requestId);
      }
    },

    async startQr(request) {
      const requestId = dependencies.createRequestId();
      const service = createService(dependencies);
      const resolved = service.resolveSession(
        parseCookie(request, SESSION_COOKIE_NAME),
      );
      const setCookie = resolved.created
        ? sessionCookie(request, resolved.session.id)
        : undefined;
      try {
        const data: StartQrLoginResponse = await withTimeout(
          () => service.startQrLogin(resolved.session.id),
          dependencies.timeoutMs,
        );
        return success(data, requestId, dependencies.now, setCookie);
      } catch (error) {
        return failure(error, requestId, setCookie);
      }
    },

    async qrStatus(request) {
      const requestId = dependencies.createRequestId();
      const sessionId = parseCookie(request, SESSION_COOKIE_NAME);
      const challengeId = getChallengeId(request);
      if (!sessionId || !challengeId) {
        return failure(
          new AppError("QR_EXPIRED", "二维码已过期，请刷新后重试。", {
            retryable: false,
          }),
          requestId,
        );
      }
      const service = createService(dependencies);
      try {
        const data = await withTimeout(
          () => service.pollQrLogin(sessionId, challengeId),
          dependencies.timeoutMs,
        );
        return success(data, requestId, dependencies.now);
      } catch (error) {
        return failure(error, requestId);
      }
    },

    async logout(request) {
      const requestId = dependencies.createRequestId();
      const service = createService(dependencies);
      const sessionId = parseCookie(request, SESSION_COOKIE_NAME);
      await service.logout(sessionId);
      return success(
        { user: null, mode: "real" },
        requestId,
        dependencies.now,
        expiredSessionCookie(request),
      );
    },
  };
}
