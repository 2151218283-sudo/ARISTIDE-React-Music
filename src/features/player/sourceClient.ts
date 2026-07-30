"use client";

import { AppError, appErrorCodes, type AppErrorCode } from "@/lib/music/errors";
import type {
  AudioQuality,
  PlaybackSource,
  Track,
} from "@/lib/music/models";
import type { PlayerSourceResolver } from "@/lib/player";

const audioQualities: readonly AudioQuality[] = [
  "standard",
  "exhigh",
  "lossless",
  "hires",
];

function isPlaybackSource(value: unknown): value is PlaybackSource {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<PlaybackSource>;
  return typeof candidate.url === "string"
    && candidate.url.length > 0
    && typeof candidate.expiresAt === "number"
    && Number.isFinite(candidate.expiresAt)
    && audioQualities.includes(candidate.quality as AudioQuality)
    && (candidate.codec === null || typeof candidate.codec === "string")
    && (candidate.bitrate === null || typeof candidate.bitrate === "number")
    && (candidate.sampleRate === null || typeof candidate.sampleRate === "number")
    && (candidate.sizeBytes === null || typeof candidate.sizeBytes === "number")
    && (candidate.corsMode === "anonymous" || candidate.corsMode === "unavailable");
}

function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === "string"
    && appErrorCodes.includes(value as AppErrorCode);
}

function normalizeFailure(value: unknown, status: number): AppError {
  if (typeof value === "object" && value !== null && "error" in value) {
    const failure = (value as { error?: unknown }).error;
    if (typeof failure === "object" && failure !== null) {
      const candidate = failure as {
        code?: unknown;
        message?: unknown;
        retryable?: unknown;
      };
      if (isAppErrorCode(candidate.code)) {
        return new AppError(
          candidate.code,
          typeof candidate.message === "string"
            ? candidate.message
            : "播放源请求失败。",
          { retryable: candidate.retryable === true },
        );
      }
    }
  }

  return new AppError(
    status === 401 ? "AUTH_REQUIRED" : "UPSTREAM_UNAVAILABLE",
    status === 401 ? "登录状态已失效，请重新登录。" : "播放源暂时不可用。",
    { retryable: status !== 401 },
  );
}

export const resolvePlaybackSource: PlayerSourceResolver = async (
  track: Track,
  context,
) => {
  const response = await fetch(
    `/api/tracks/${encodeURIComponent(track.id)}/source`,
    {
      cache: "no-store",
      credentials: "same-origin",
      signal: context.signal,
    },
  );

  if (context.cancelled()) {
    throw new AppError("NETWORK_ERROR", "播放源请求已取消。", { retryable: true });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw normalizeFailure(null, response.status);
  }

  if (!response.ok
    || typeof body !== "object"
    || body === null
    || !("ok" in body)
    || body.ok !== true) {
    throw normalizeFailure(body, response.status);
  }

  const data = "data" in body ? body.data : null;
  if (!isPlaybackSource(data)) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "播放源响应格式无效。",
      { retryable: true },
    );
  }

  return data;
};
