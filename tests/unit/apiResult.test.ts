import { describe, expect, it } from "vitest";

import { createApiFailure, createApiSuccess } from "../../src/lib/music/apiResult";
import { AppError, normalizeUnknownError } from "../../src/lib/music/errors";

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
});
