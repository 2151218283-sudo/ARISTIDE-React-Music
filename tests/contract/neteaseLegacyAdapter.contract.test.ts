import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { LegacyNeteaseAdapter } from "../../src/lib/music/netease/adapter";
import {
  mapQrPollResult,
} from "../../src/lib/music/netease/normalize";
import type {
  LegacyApiMethod,
  LegacyApiResponse,
  LegacyNeteaseApi,
} from "../../src/lib/music/netease/types";

const expectedIntegrity = "sha512-yRDwpMcLZnOSkmR/flEpGEJpufNxOQVILb2+2mnSrKPZp/3PbIo2uIOuTa3SjGaAtK3dUKJdQBTkOn0POKDa+A==";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a record in contract test input.");
  }
  return value as Record<string, unknown>;
}

function response(body: unknown, status = 200): LegacyApiResponse {
  return { status, body, cookie: [] };
}

function method(body: unknown): LegacyApiMethod {
  return async () => response(body);
}

function opaqueRuntimeValue(): string {
  return randomBytes(32).toString("base64url");
}

function makeApi(overrides: Partial<LegacyNeteaseApi> = {}): LegacyNeteaseApi {
  return {
    check_music: method({ code: 200, success: true }),
    comment_music: method({ code: 200, comments: [], total: 0, more: false }),
    login_qr_create: method({ code: 200, data: { qrimg: "data:image/png;base64,visual-stage-placeholder" } }),
    login_qr_check: method({ code: 801 }),
    login_qr_key: async () => response({
      code: 200,
      data: { unikey: opaqueRuntimeValue() },
    }),
    login_status: method({ data: { code: 200, account: null, profile: null } }),
    lyric_new: method({ code: 200, lrc: { lyric: "" } }),
    logout: method({ code: 200 }),
    search: method({ code: 200, result: { songs: [], songCount: 0 } }),
    song_detail: method({ code: 200, songs: [], privileges: [] }),
    song_url_v1: method({ code: 200, data: [] }),
    ...overrides,
  };
}

function syntheticTrack(id = 101) {
  return {
    id,
    name: "Synthetic Signal",
    ar: [{ id: 201, name: "Synthetic Artist" }],
    al: {
      id: 301,
      name: "Synthetic Album",
      picUrl: "https://example.invalid/artwork",
    },
    dt: 180_000,
    alia: ["Alternate Signal"],
    fee: 0,
  };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("Legacy package boundary", () => {
  it("pins the verified package version and lockfile integrity", () => {
    const root = process.cwd();
    const packageJson: unknown = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    );
    const packageLock: unknown = JSON.parse(
      readFileSync(resolve(root, "package-lock.json"), "utf8"),
    );
    const dependencies = record(record(packageJson).dependencies);
    const packages = record(record(packageLock).packages);
    const installed = record(packages["node_modules/NeteaseCloudMusicApi"]);

    expect(dependencies.NeteaseCloudMusicApi).toBe("4.32.0");
    expect(installed.version).toBe("4.32.0");
    expect(installed.integrity).toBe(expectedIntegrity);
  });

  it("references the upstream package only inside the netease server loader", () => {
    const sourceRoot = resolve(process.cwd(), "src");
    const references = sourceFiles(sourceRoot).filter((file) => (
      readFileSync(file, "utf8").includes("NeteaseCloudMusicApi")
    ));

    expect(references.map((file) => file.replaceAll("\\", "/"))).toEqual([
      expect.stringMatching(/src\/lib\/music\/netease\/legacyApi\.server\.ts$/),
    ]);
  });

  it("passes an explicit transport proxy only to server-side upstream calls", async () => {
    const qrKey = vi.fn<LegacyApiMethod>(async () => response({
      code: 200,
      data: { unikey: opaqueRuntimeValue() },
    }));
    const qrCreate = vi.fn<LegacyApiMethod>(async () => response({
      code: 200,
      data: { qrimg: "data:image/png;base64,visual-stage-placeholder" },
    }));
    const adapter = new LegacyNeteaseAdapter(makeApi({
      login_qr_key: qrKey,
      login_qr_create: qrCreate,
    }), { transportProxyUrl: "http://127.0.0.1:7897/" });

    await adapter.startQrLogin();

    expect(qrKey).toHaveBeenCalledWith({
      proxy: "http://127.0.0.1:7897/",
    });
    expect(qrCreate).toHaveBeenCalledWith({
      key: expect.any(String),
      qrimg: true,
      proxy: "http://127.0.0.1:7897/",
    });
  });
});

describe("Legacy anonymous reads", () => {
  it("normalizes track search and detail without leaking upstream field names", async () => {
    const search = vi.fn<LegacyApiMethod>(async (params) => {
      if (params.type !== 1) {
        throw new Error("unexpected synthetic search type");
      }
      return response({
        code: 200,
        result: { songs: [syntheticTrack()], songCount: 1 },
      });
    });
    const detail = vi.fn<LegacyApiMethod>(async () => response({
      code: 200,
      songs: [syntheticTrack()],
      privileges: [{ id: 101, fee: 0, playMaxLevel: "lossless" }],
    }));
    const adapter = new LegacyNeteaseAdapter(makeApi({
      search,
      song_detail: detail,
    }));

    const searchResult = await adapter.search({
      text: "  Signal  ",
      type: "track",
      limit: 20,
      offset: 0,
    });
    const track = await adapter.getTrack("101");

    expect(search).toHaveBeenCalledWith({
      keywords: "Signal",
      type: 1,
      limit: 20,
      offset: 0,
    });
    expect(searchResult).toMatchObject({
      type: "track",
      items: [{
        id: "101",
        name: "Synthetic Signal",
        durationMs: 180_000,
        availability: "unknown",
      }],
      total: 1,
      hasMore: false,
    });
    expect(track).toMatchObject({
      id: "101",
      artists: [{ id: "201", name: "Synthetic Artist" }],
      album: { id: "301", name: "Synthetic Album" },
      privilege: { fee: 0, maxQuality: "lossless" },
    });
    for (const field of ["ar", "al", "dt", "alia"]) {
      expect(track).not.toHaveProperty(field);
    }
  });

  it("keeps successful sections when all-search has one upstream failure", async () => {
    const search = vi.fn<LegacyApiMethod>(async (params) => {
      if (params.type === 100) {
        throw new Error("synthetic upstream failure");
      }
      if (params.type === 10) {
        return response({
          code: 200,
          result: {
            albums: [{
              id: 401,
              name: "Synthetic Collection",
              picUrl: "https://example.invalid/album-art",
            }],
            albumCount: 1,
          },
        });
      }
      return response({
        code: 200,
        result: { songs: [syntheticTrack()], songCount: 1 },
      });
    });
    const adapter = new LegacyNeteaseAdapter(makeApi({ search }));

    const result = await adapter.search({
      text: "Signal",
      type: "all",
      limit: 20,
      offset: 0,
    });

    expect(result).toMatchObject({
      type: "all",
      tracks: { items: [{ id: "101" }] },
      artists: { items: [] },
      albums: { items: [{ id: "401" }] },
      partialErrors: [{
        type: "artist",
        code: "UPSTREAM_UNAVAILABLE",
        retryable: true,
      }],
    });
  });

  it("normalizes the source-verified artist search shape", async () => {
    const adapter = new LegacyNeteaseAdapter(makeApi({
      search: method({
        code: 200,
        result: {
          artists: [{
            id: 701,
            name: "Synthetic Performer",
            img1v1Url: "https://example.invalid/artist-art",
          }],
          artistCount: 1,
        },
      }),
    }));

    const result = await adapter.search({
      text: "Performer",
      type: "artist",
      limit: 20,
      offset: 0,
    });

    expect(result).toMatchObject({
      type: "artist",
      items: [{
        id: "701",
        name: "Synthetic Performer",
        avatarUrl: "https://example.invalid/artist-art",
      }],
      total: 1,
      hasMore: false,
    });
  });

  it("does not request a source after the availability preflight fails", async () => {
    const source = vi.fn<LegacyApiMethod>(async () => response({
      code: 200,
      data: [],
    }));
    const adapter = new LegacyNeteaseAdapter(makeApi({
      check_music: method({ code: 200, success: false }),
      song_url_v1: source,
    }));

    await expect(adapter.getPlaybackSource("101", "standard"))
      .rejects.toMatchObject({ code: "TRACK_UNAVAILABLE" });
    expect(source).not.toHaveBeenCalled();
  });

  it("rejects root success with a 404 source row or null URL", async () => {
    const source = vi.fn<LegacyApiMethod>()
      .mockResolvedValueOnce(response({
        code: 200,
        data: [{ id: 101, code: 404, url: null }],
      }))
      .mockResolvedValueOnce(response({
        code: 200,
        data: [{ id: 101, code: 200, url: null }],
      }));
    const adapter = new LegacyNeteaseAdapter(makeApi({ song_url_v1: source }));

    await expect(adapter.getPlaybackSource("101", "standard"))
      .rejects.toMatchObject({ code: "TRACK_UNAVAILABLE" });
    await expect(adapter.getPlaybackSource("101", "standard"))
      .rejects.toMatchObject({ code: "TRACK_UNAVAILABLE" });
  });

  it("normalizes a valid short-lived source without assuming CORS", async () => {
    const adapter = new LegacyNeteaseAdapter(makeApi({
      song_url_v1: method({
        code: 200,
        data: [{
          id: 101,
          code: 200,
          url: "https://example.invalid/runtime-stream",
          expi: 120,
          level: "exhigh",
          encodeType: "mp3",
          br: 320_000,
          sr: 44_100,
          size: 4_096,
        }],
      }),
    }), { now: () => 1_000_000 });

    const result = await adapter.getPlaybackSource("101", "lossless");

    expect(result.expiresAt).toBe(1_120_000);
    expect(result.quality).toBe("exhigh");
    expect(result.codec).toBe("mp3");
    expect(result.corsMode).toBe("unavailable");
  });

  it("degrades naturally to line lyrics when yrc is absent", async () => {
    const adapter = new LegacyNeteaseAdapter(makeApi({
      lyric_new: method({
        code: 200,
        lrc: { lyric: "[00:01.00]First line\n[00:03.00]Second line" },
        tlyric: { lyric: "[00:01.00]Translation" },
      }),
    }));

    const lyrics = await adapter.getLyrics("101");

    expect(lyrics.kind).toBe("synced");
    expect(lyrics.lines).toHaveLength(2);
    expect(lyrics.lines[0]).toMatchObject({
      startMs: 1_000,
      text: "First line",
      translation: "Translation",
      words: null,
    });
  });

  it("normalizes a sanitized comment page and optional reply", async () => {
    const adapter = new LegacyNeteaseAdapter(makeApi({
      comment_music: method({
        code: 200,
        comments: [{
          commentId: 501,
          user: { userId: 601, nickname: "Synthetic Listener" },
          content: "Synthetic comment",
          time: 1_700_000_000_000,
          likedCount: 3,
          liked: false,
          beReplied: [{
            beRepliedCommentId: 502,
            user: { nickname: "Synthetic Reply Author" },
          }],
        }],
        total: 1,
        more: false,
      }),
    }));

    const comments = await adapter.getComments("101", { limit: 20, offset: 0 });

    expect(comments).toMatchObject({
      items: [{
        id: "501",
        author: { id: "601", nickname: "Synthetic Listener" },
        content: "Synthetic comment",
        replyTo: { id: "502", nickname: "Synthetic Reply Author" },
      }],
      total: 1,
      hasMore: false,
    });
  });
});

describe("Legacy error and QR normalization", () => {
  it("maps the verified QR 801 code to waiting without returning upstream fields", () => {
    expect(mapQrPollResult({ code: 801 })).toEqual({ status: "waiting" });
  });

  it("maps unknown response shapes and thrown errors to stable safe errors", async () => {
    const invalidShape = new LegacyNeteaseAdapter(makeApi({
      song_detail: method({ code: 200, songs: "invalid" }),
    }));
    const thrown = new LegacyNeteaseAdapter(makeApi({
      song_detail: async () => {
        throw new Error("sensitive synthetic upstream body");
      },
    }));

    await expect(invalidShape.getTrack("101")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
    });
    await expect(thrown.getTrack("101")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      message: "网易云服务暂时不可用。",
      retryable: true,
    });
  });

  it("rejects a non-200 root business code even when HTTP status is 200", async () => {
    const adapter = new LegacyNeteaseAdapter(makeApi({
      search: method({ code: 500, message: "synthetic raw failure" }),
    }));

    await expect(adapter.search({
      text: "Signal",
      type: "track",
      limit: 20,
      offset: 0,
    })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      message: "网易云服务暂时不可用。",
      retryable: true,
    });
  });
});
