"use client";

import { useCallback, useEffect, useState } from "react";

import type { ApiResult } from "@/lib/music/apiResult";
import type { LyricDocument, Track } from "@/lib/music/models";

export interface TrackPageError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface TrackPageResource<T> {
  data: T | null;
  error: TrackPageError | null;
  retry(): void;
  status: "idle" | "loading" | "ready" | "error";
}

export interface TrackPageDetailsState {
  lyrics: TrackPageResource<LyricDocument>;
  track: TrackPageResource<Track>;
}

interface ResourceState<T> {
  data: T | null;
  error: TrackPageError | null;
  status: "idle" | "loading" | "ready" | "error";
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

function toTrackPageError(error: unknown, fallbackMessage: string): TrackPageError {
  if (typeof error === "object" && error !== null && !Array.isArray(error)) {
    const candidate = error as Partial<TrackPageError>;
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
    throw new Error("The track page resource could not be loaded.");
  }

  return body.data;
}

export function useTrackPageDetails(trackId: string): TrackPageDetailsState {
  const [trackRequestVersion, setTrackRequestVersion] = useState(0);
  const [lyricsRequestVersion, setLyricsRequestVersion] = useState(0);
  const [track, setTrack] = useState<ResourceState<Track>>(idleTrackState);
  const [lyrics, setLyrics] = useState<ResourceState<LyricDocument>>(idleLyricsState);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setTrack({ data: null, error: null, status: "loading" });
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
          error: toTrackPageError(error, "暂时无法读取歌曲详情。"),
          status: "error",
        });
      }
    });

    return () => controller.abort();
  }, [trackId, trackRequestVersion]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setLyrics({ data: null, error: null, status: "loading" });
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
          error: toTrackPageError(error, "歌词暂时不可用。"),
          status: "error",
        });
      }
    });

    return () => controller.abort();
  }, [lyricsRequestVersion, trackId]);

  const retryTrack = useCallback(() => {
    setTrackRequestVersion((version) => version + 1);
  }, []);
  const retryLyrics = useCallback(() => {
    setLyricsRequestVersion((version) => version + 1);
  }, []);

  return {
    lyrics: { ...lyrics, retry: retryLyrics },
    track: { ...track, retry: retryTrack },
  };
}
