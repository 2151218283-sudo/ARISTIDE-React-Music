import { describe, expect, it } from "vitest";

import { createApiFailure, createApiSuccess } from "../../src/lib/music/apiResult";
import {
  AppError,
  normalizeUnknownError,
  type AppErrorDetails,
} from "../../src/lib/music/errors";

describe("music API result", () => {
  it("wraps a successful normalized response with mode metadata", () => {
    const result = createApiSuccess(
      { trackId: "demo-track-001" },
      {
        requestId: "request-001",
        mode: "demo",
        fetchedAt: "2026-07-29T00:00:00.000Z",
      },
    );

    expect(result).toEqual({
      ok: true,
      data: { trackId: "demo-track-001" },
      meta: {
        requestId: "request-001",
        mode: "demo",
        fetchedAt: "2026-07-29T00:00:00.000Z",
      },
    });
  });

  it("preserves only explicit AppError fields in a failure envelope", () => {
    const result = createApiFailure(
      new AppError(
        "TRACK_UNAVAILABLE",
        "这首歌曲暂不可播放，请选择下一首。",
        {
          retryable: false,
          details: { trackId: "demo-track-001" },
        },
      ),
      "request-002",
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "TRACK_UNAVAILABLE",
        message: "这首歌曲暂不可播放，请选择下一首。",
        retryable: false,
        requestId: "request-002",
        details: { trackId: "demo-track-001" },
      },
    });
  });

  it("does not expose an unknown exception message", () => {
    const normalized = normalizeUnknownError(
      new Error("private upstream response must not escape"),
    );

    expect(normalized).toMatchObject({
      code: "UNKNOWN_ERROR",
      retryable: true,
    });
    expect(normalized.message).not.toContain("private upstream response");
  });

  it("removes unknown or sensitive details before creating a browser response", () => {
    const unsafeDetails = {
      trackId: "demo-track-001",
      cookie: "MUSIC_U=private",
      qrKey: "private-qr-key",
      sourceUrl: "https://media.example/private.mp3",
      commentContent: "private comment",
      rawResponse: "private upstream body",
    } as unknown as AppErrorDetails;
    const result = createApiFailure(
      new AppError("UPSTREAM_UNAVAILABLE", "请求失败。", {
        details: unsafeDetails,
      }),
      "request-003",
    );

    expect(result.error.details).toEqual({ trackId: "demo-track-001" });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("removes an invalid public detail value instead of exposing it", () => {
    const result = createApiFailure(
      new AppError("TRACK_UNAVAILABLE", "歌曲不可播放。", {
        details: {
          trackId: "https://media.example/private.mp3",
        },
      }),
      "request-004",
    );

    expect(result.error).not.toHaveProperty("details");
  });
});
