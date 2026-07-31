"use client";

import { useCallback, useEffect, useState } from "react";

import type { ApiResult } from "@/lib/music/apiResult";
import type { LyricDocument, Track } from "@/lib/music/models";

export interface TrackPreviewError {
  code: string;
  message: string;
  retryable: boolean;
}

interface ResourceState<T> {
  data: T | null;
  error: TrackPreviewError | null;
  status: "idle" | "loading" | "ready" | "error";
}

export interface TrackPreviewDetailsState {
  lyrics: ResourceState<LyricDocument>;
  retry(): void;
  track: ResourceState<Track>;
}

const idleTrackState: ResourceState<Track> = {
  data: null,
  error: null,
  status: "idle",
};

const idleLyricsState: ResourceState<LyricDocument> = {
  data: null,
  error: null,
  status: "idle",
};

function toPreviewError(error: unknown, fallbackMessage: string): TrackPreviewError {
  if (typeof error === "object" && error !== null && !Array.isArray(error)) {
    const candidate = error as Partial<TrackPreviewError>;
    if (
      typeof candidate.code === "string"
      && typeof candidate.message === "string"
      && typeof candidate.retryable === "boolean"
    ) {
      return {
        code: candidate.code,
        message: candidate.message,
        retryable: candidate.retryable,
      };
    }
  }

  return {
    code: "NETWORK_ERROR",
    message: fallbackMessage,
    retryable: true,
  };
}

async function readResource<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  const body = await response.json() as ApiResult<T>;

  if (!response.ok || !body.ok) {
    if (!body.ok) {
      throw body.error;
    }
    throw new Error("The preview resource could not be loaded.");
  }

  return body.data;
}

export function useTrackPreviewDetails(
  trackId: string | null,
  enabled: boolean,
): TrackPreviewDetailsState {
  const [requestVersion, setRequestVersion] = useState(0);
  const [track, setTrack] = useState<ResourceState<Track>>(idleTrackState);
  const [lyrics, setLyrics] = useState<ResourceState<LyricDocument>>(idleLyricsState);

  useEffect(() => {
    if (!trackId || !enabled) {
      return;
    }

    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setTrack({ data: null, error: null, status: "loading" });
        setLyrics({ data: null, error: null, status: "loading" });
      }
    });

    void readResource<Track>(
      `/api/tracks/${encodeURIComponent(trackId)}`,
      controller.signal,
    ).then((data) => {
      if (!controller.signal.aborted) {
        setTrack({ data, error: null, status: "ready" });
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setTrack({
          data: null,
          error: toPreviewError(error, "暂时无法读取歌曲详情。"),
          status: "error",
        });
      }
    });

    void readResource<LyricDocument>(
      `/api/tracks/${encodeURIComponent(trackId)}/lyrics`,
      controller.signal,
    ).then((data) => {
      if (!controller.signal.aborted) {
        setLyrics({ data, error: null, status: "ready" });
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setLyrics({
          data: null,
          error: toPreviewError(error, "歌词摘要暂时不可用。"),
          status: "error",
        });
      }
    });

    return () => controller.abort();
  }, [enabled, requestVersion, trackId]);

  const retry = useCallback(() => {
    setRequestVersion((version) => version + 1);
  }, []);

  return { lyrics, retry, track };
}
