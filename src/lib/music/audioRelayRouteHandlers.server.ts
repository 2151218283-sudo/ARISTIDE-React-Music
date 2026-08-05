import { randomUUID } from "node:crypto";

import { createApiFailure } from "./apiResult";
import {
  audioRelayHeaders,
  isAllowedAudioRelayUrl,
  openRelayedAudio,
  parseAudioRange,
  type OpenAudioUpstream,
} from "./audioRelay.server";
import { AppError, isAppError, type AppErrorCode } from "./errors";
import type { PlaybackSource } from "./models";
import type { PublicReadRouteHandlers } from "./bff";
import {
  readSessionIdFromRequest,
  type InMemorySessionStore,
} from "../session/sessionStore";
import { createSessionCookie } from "../session/authBff";

const noStoreCacheControl = "no-store";
const trackIdPattern = /^\d{1,20}$/;

type SourceReadHandler = Pick<PublicReadRouteHandlers, "source">;

export interface AudioRelayRouteHandlers {
  source(request: Request, trackId: string): Promise<Response>;
  audio(request: Request, trackId: string): Promise<Response>;
}

export interface AudioRelayRouteDependencies {
  publicReadRouteHandlers: SourceReadHandler;
  store: InMemorySessionStore;
  createRequestId?: () => string;
  openAudioUpstream?: OpenAudioUpstream;
}

interface ResolvedDependencies {
  publicReadRouteHandlers: SourceReadHandler;
  store: InMemorySessionStore;
  createRequestId: () => string;
  openAudioUpstream: OpenAudioUpstream | undefined;
}

function resolveDependencies(input: AudioRelayRouteDependencies): ResolvedDependencies {
  return {
    publicReadRouteHandlers: input.publicReadRouteHandlers,
    store: input.store,
    createRequestId: input.createRequestId ?? randomUUID,
    openAudioUpstream: input.openAudioUpstream,
  };
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

function errorResponse(error: unknown, requestId: string): Response {
  const appError = toAppError(error);
  return Response.json(createApiFailure(appError, requestId), {
    status: statusForError(appError.code),
    headers: {
      "Cache-Control": noStoreCacheControl,
      "X-Request-Id": requestId,
    },
  });
}

function parseTrackId(trackId: string): string {
  const normalized = trackId.trim();
  if (!trackIdPattern.test(normalized)) {
    throw new AppError("VALIDATION_ERROR", "歌曲 ID 格式无效。", {
      retryable: false,
    });
  }
  return normalized;
}

function isPlaybackSource(value: unknown): value is PlaybackSource {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<PlaybackSource>;
  return typeof candidate.url === "string"
    && candidate.url.length > 0
    && typeof candidate.expiresAt === "number"
    && Number.isFinite(candidate.expiresAt)
    && typeof candidate.quality === "string"
    && (candidate.corsMode === "anonymous" || candidate.corsMode === "unavailable");
}

function isSourceSuccess(value: unknown): value is {
  ok: true;
  data: PlaybackSource;
  meta?: unknown;
} {
  return typeof value === "object"
    && value !== null
    && (value as { ok?: unknown }).ok === true
    && isPlaybackSource((value as { data?: unknown }).data);
}

function isRelayedSourceAllowed(source: PlaybackSource): boolean {
  try {
    return isAllowedAudioRelayUrl(new URL(source.url));
  } catch {
    return false;
  }
}

function sourcePath(trackId: string): string {
  return `/api/tracks/${encodeURIComponent(trackId)}/audio`;
}

function sourceResponseHeaders(
  sourceResponse: Response,
  setCookie: string | undefined,
): Headers {
  const headers = new Headers({
    "Cache-Control": noStoreCacheControl,
    "X-Request-Id": sourceResponse.headers.get("X-Request-Id") ?? "",
  });
  if (setCookie) {
    headers.set("Set-Cookie", setCookie);
  }
  return headers;
}

function sourceExpiredError(trackId: string): AppError {
  return new AppError("SOURCE_EXPIRED", "播放源已过期，请刷新后重试。", {
    details: { trackId },
    retryable: true,
  });
}

export function createAudioRelayRouteHandlers(
  inputDependencies: AudioRelayRouteDependencies,
): AudioRelayRouteHandlers {
  const dependencies = resolveDependencies(inputDependencies);

  return {
    async source(request, trackId) {
      const requestId = dependencies.createRequestId();
      let id: string;
      try {
        id = parseTrackId(trackId);
      } catch (error) {
        return errorResponse(error, requestId);
      }

      const sourceResponse = await dependencies.publicReadRouteHandlers.source(request, id);
      if (!sourceResponse.ok) {
        return sourceResponse;
      }

      const sourceRequestId = sourceResponse.headers.get("X-Request-Id") ?? requestId;
      let body: unknown;
      try {
        body = await sourceResponse.json();
      } catch {
        return errorResponse(new AppError(
          "UPSTREAM_UNAVAILABLE",
          "播放源响应无效。",
          { retryable: true },
        ), sourceRequestId);
      }

      if (!isSourceSuccess(body) || !isRelayedSourceAllowed(body.data)) {
        return errorResponse(new AppError(
          "UPSTREAM_UNAVAILABLE",
          "播放源暂时不可用。",
          { retryable: true },
        ), sourceRequestId);
      }

      const resolved = dependencies.store.resolve(readSessionIdFromRequest(request));
      if (!dependencies.store.setAudioRelaySource(resolved.session.id, id, body.data)) {
        return errorResponse(sourceExpiredError(id), sourceRequestId);
      }

      return Response.json({
        ...body,
        data: { ...body.data, url: sourcePath(id) },
      }, {
        status: 200,
        headers: sourceResponseHeaders(
          sourceResponse,
          resolved.created ? createSessionCookie(request, resolved.session.id) : undefined,
        ),
      });
    },

    async audio(request, trackId) {
      const requestId = dependencies.createRequestId();
      try {
        const id = parseTrackId(trackId);
        const range = parseAudioRange(request);
        const sessionId = readSessionIdFromRequest(request);
        const source = sessionId
          ? dependencies.store.getAudioRelaySource(sessionId, id)
          : null;
        if (!source) {
          throw sourceExpiredError(id);
        }

        const upstream = await openRelayedAudio(
          source.url,
          range,
          dependencies.openAudioUpstream,
        );
        return new Response(upstream.body, {
          status: upstream.status,
          headers: audioRelayHeaders(upstream.headers),
        });
      } catch (error) {
        return errorResponse(error, requestId);
      }
    },
  };
}
