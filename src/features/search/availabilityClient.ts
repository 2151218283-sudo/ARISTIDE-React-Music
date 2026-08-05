"use client";

export type SearchTrackPlayability =
  | "unknown"
  | "checking"
  | "verified-playable"
  | "unavailable";

export class AvailabilityClientError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "AvailabilityClientError";
    this.retryable = retryable;
  }
}

function isAvailabilityState(value: unknown): value is "verified-playable" | "unavailable" {
  return value === "verified-playable" || value === "unavailable";
}

export async function requestTrackAvailability(
  trackId: string,
  signal: AbortSignal,
): Promise<"verified-playable" | "unavailable"> {
  const response = await fetch(
    `/api/tracks/${encodeURIComponent(trackId)}/availability`,
    {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    },
  );

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AvailabilityClientError("无法验证歌曲是否可播放，请稍后重试。", true);
  }

  if (
    response.ok
    && typeof body === "object"
    && body !== null
    && "ok" in body
    && body.ok === true
    && "data" in body
    && typeof body.data === "object"
    && body.data !== null
    && "state" in body.data
    && isAvailabilityState(body.data.state)
  ) {
    return body.data.state;
  }

  if (
    typeof body === "object"
    && body !== null
    && "error" in body
    && typeof body.error === "object"
    && body.error !== null
  ) {
    const error = body.error as { code?: unknown; message?: unknown; retryable?: unknown };
    if (
      error.code === "TRACK_UNAVAILABLE"
      || error.code === "VIP_REQUIRED"
      || error.code === "REGION_RESTRICTED"
    ) {
      return "unavailable";
    }
    throw new AvailabilityClientError(
      typeof error.message === "string"
        ? error.message
        : "无法验证歌曲是否可播放，请稍后重试。",
      error.retryable === true,
    );
  }

  throw new AvailabilityClientError("无法验证歌曲是否可播放，请稍后重试。", true);
}
