import {
  AppError,
  isAppError,
} from "../errors";
import type {
  AudioQuality,
  CommentPage,
  LyricDocument,
  PageQuery,
  PlaybackSource,
  SearchAllResult,
  SearchKind,
  SearchPage,
  SearchPartialError,
  SearchQuery,
  SearchResponse,
  Track,
  AlbumSummary,
  ArtistSummary,
} from "../models";
import {
  assertTrackPlayable,
  mapCommentPage,
  mapLyrics,
  mapPlaybackSource,
  mapQrPollResult,
  mapSearchPage,
  mapTrackDetail,
  unwrapLegacyBody,
  unwrapLegacyQrBody,
} from "./normalize";
import type {
  LegacyAdapterOptions,
  LegacyApiMethod,
  LegacyNeteaseApi,
  LegacyQrPollResult,
} from "./types";

const upstreamSearchTypes: Record<SearchKind, 1 | 10 | 100> = {
  track: 1,
  album: 10,
  artist: 100,
};

const qualityBitrates: Record<AudioQuality, number> = {
  standard: 128_000,
  exhigh: 320_000,
  lossless: 999_000,
  hires: 1_999_000,
};

const trackIdPattern = /^\d{1,20}$/;

function validationError(message: string): AppError {
  return new AppError("VALIDATION_ERROR", message);
}

function safeUpstreamError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }
  return new AppError(
    "UPSTREAM_UNAVAILABLE",
    "网易云服务暂时不可用。",
    { retryable: true },
  );
}

function validateTrackId(trackId: string): string {
  const normalized = trackId.trim();
  if (!trackIdPattern.test(normalized)) {
    throw validationError("歌曲 ID 格式无效。");
  }
  return normalized;
}

function validatePage(page: PageQuery, maximum: number): void {
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > maximum) {
    throw validationError(`limit 必须是 1 至 ${maximum} 的整数。`);
  }
  if (!Number.isInteger(page.offset) || page.offset < 0) {
    throw validationError("offset 必须是非负整数。");
  }
}

function validateSearch(query: SearchQuery): string {
  const normalized = query.text.trim();
  if (normalized.length < 1 || normalized.length > 100) {
    throw validationError("搜索关键词长度必须是 1 至 100 个字符。");
  }
  validatePage(query, 30);
  return normalized;
}

function withCookie(
  params: Readonly<Record<string, unknown>>,
  cookie: string | undefined,
): Readonly<Record<string, unknown>> {
  return cookie ? { ...params, cookie } : params;
}

export class LegacyNeteaseAdapter {
  private readonly now: () => number;

  constructor(
    private readonly api: LegacyNeteaseApi,
    options: LegacyAdapterOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  private async invoke(
    method: LegacyApiMethod,
    params: Readonly<Record<string, unknown>>,
  ) {
    try {
      return await method(params);
    } catch (error) {
      throw safeUpstreamError(error);
    }
  }

  private async searchKind(
    text: string,
    type: "track",
    limit: number,
    offset: number,
    cookie?: string,
  ): Promise<SearchPage<Track, "track">>;
  private async searchKind(
    text: string,
    type: "album",
    limit: number,
    offset: number,
    cookie?: string,
  ): Promise<SearchPage<AlbumSummary, "album">>;
  private async searchKind(
    text: string,
    type: "artist",
    limit: number,
    offset: number,
    cookie?: string,
  ): Promise<SearchPage<ArtistSummary, "artist">>;
  private async searchKind(
    text: string,
    type: SearchKind,
    limit: number,
    offset: number,
    cookie?: string,
  ): Promise<SearchPage<Track, "track"> | SearchPage<AlbumSummary, "album">
    | SearchPage<ArtistSummary, "artist">> {
    const response = await this.invoke(this.api.search, withCookie({
      keywords: text,
      type: upstreamSearchTypes[type],
      limit,
      offset,
    }, cookie));
    const body = unwrapLegacyBody(response);
    if (type === "track") {
      return mapSearchPage(body, type, limit, offset);
    }
    if (type === "album") {
      return mapSearchPage(body, type, limit, offset);
    }
    return mapSearchPage(body, type, limit, offset);
  }

  async search(query: SearchQuery, cookie?: string): Promise<SearchResponse> {
    const searchText = validateSearch(query);
    if (query.type === "track") {
      return this.searchKind(searchText, "track", query.limit, query.offset, cookie);
    }
    if (query.type === "album") {
      return this.searchKind(searchText, "album", query.limit, query.offset, cookie);
    }
    if (query.type === "artist") {
      return this.searchKind(searchText, "artist", query.limit, query.offset, cookie);
    }

    const results = await Promise.allSettled([
      this.searchKind(searchText, "track", 5, 0, cookie),
      this.searchKind(searchText, "artist", 4, 0, cookie),
      this.searchKind(searchText, "album", 4, 0, cookie),
    ] as const);
    const partialErrors: SearchPartialError[] = [];
    const kinds = ["track", "artist", "album"] as const;
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const error = safeUpstreamError(result.reason);
        partialErrors.push({
          type: kinds[index],
          code: error.code,
          retryable: error.retryable,
        });
      }
    });

    if (partialErrors.length === results.length) {
      throw safeUpstreamError(
        results.find((result) => result.status === "rejected")?.reason,
      );
    }

    const trackResult = results[0];
    const artistResult = results[1];
    const albumResult = results[2];
    const response: SearchAllResult = {
      type: "all",
      tracks: trackResult.status === "fulfilled"
        ? {
          items: trackResult.value.items,
          total: trackResult.value.total,
          hasMore: trackResult.value.hasMore,
        }
        : { items: [], total: null, hasMore: false },
      artists: artistResult.status === "fulfilled"
        ? {
          items: artistResult.value.items,
          total: artistResult.value.total,
          hasMore: artistResult.value.hasMore,
        }
        : { items: [], total: null, hasMore: false },
      albums: albumResult.status === "fulfilled"
        ? {
          items: albumResult.value.items,
          total: albumResult.value.total,
          hasMore: albumResult.value.hasMore,
        }
        : { items: [], total: null, hasMore: false },
      partialErrors,
    };
    return response;
  }

  async getTrack(trackId: string, cookie?: string): Promise<Track> {
    const id = validateTrackId(trackId);
    const response = await this.invoke(
      this.api.song_detail,
      withCookie({ ids: id }, cookie),
    );
    return mapTrackDetail(unwrapLegacyBody(response), id);
  }

  async getPlaybackSource(
    trackId: string,
    quality: AudioQuality,
    cookie?: string,
  ): Promise<PlaybackSource> {
    const id = validateTrackId(trackId);
    const availabilityResponse = await this.invoke(
      this.api.check_music,
      withCookie({ id, br: qualityBitrates[quality] }, cookie),
    );
    assertTrackPlayable(unwrapLegacyBody(availabilityResponse), id);

    const sourceResponse = await this.invoke(
      this.api.song_url_v1,
      withCookie({ id, level: quality }, cookie),
    );
    return mapPlaybackSource(
      unwrapLegacyBody(sourceResponse),
      id,
      quality,
      this.now(),
    );
  }

  async getLyrics(trackId: string, cookie?: string): Promise<LyricDocument> {
    const id = validateTrackId(trackId);
    const response = await this.invoke(
      this.api.lyric_new,
      withCookie({ id }, cookie),
    );
    return mapLyrics(unwrapLegacyBody(response));
  }

  async getComments(
    trackId: string,
    page: PageQuery,
    cookie?: string,
  ): Promise<CommentPage> {
    const id = validateTrackId(trackId);
    validatePage(page, 100);
    const response = await this.invoke(this.api.comment_music, withCookie({
      id,
      limit: page.limit,
      offset: page.offset,
    }, cookie));
    return mapCommentPage(unwrapLegacyBody(response), page.limit, page.offset);
  }

  async pollQrCode(key: string): Promise<LegacyQrPollResult> {
    if (!key || key.length > 256) {
      throw validationError("二维码凭据格式无效。");
    }
    const response = await this.invoke(this.api.login_qr_check, { key });
    return mapQrPollResult(unwrapLegacyQrBody(response));
  }
}
