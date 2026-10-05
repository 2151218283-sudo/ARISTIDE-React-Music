import {
  AppError,
  isAppError,
} from "../errors";
import type {
  AlbumDetail,
  ArtistDetail,
  AudioQuality,
  CatalogPage,
  CommentPage,
  LyricDocument,
  HotSearchTerm,
  PageQuery,
  PlaybackSource,
  Playlist,
  PlaylistDetail,
  SearchAllResult,
  SearchKind,
  SearchPage,
  SearchPartialError,
  SearchQuery,
  SearchResponse,
  Track,
  AlbumSummary,
  ArtistSummary,
  ChangePlaylistTracksInput,
  CreateCommentInput,
  CreatePlaylistInput,
  UpdatePlaylistInput,
  DeletePlaylistInput,
  UserPlaylistCollection,
  UserProfile,
} from "../models";
import {
  assertTrackPlayable,
  mapCommentPage,
  mapLyrics,
  mapPlaybackSource,
  mapQrChallenge,
  mapQrPollResult,
  mapSearchPage,
  mapSessionUser,
  mapTracks,
  mapTrackDetail,
  asRecord,
  mapAlbumDetail,
  mapArtistDetail,
  mapNewSongs,
  mapPlaylistPage,
  mapPlaylistDetail,
  mapPlaylist,
  mapSavedAlbumPage,
  mapHotSearches,
  mapUserPlaylistCollection,
  mapUserProfile,
  unwrapLegacyBody,
  unwrapLegacyQrBody,
} from "./normalize";
import type {
  LegacyAdapterOptions,
  LegacyApiMethod,
  LegacyNeteaseApi,
  LegacyQrChallenge,
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
const publicSelectionCandidateLimit = 24;
const publicSelectionTargetSize = 12;
const publicSelectionProbeConcurrency = 4;

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

function validateUserId(userId: string): string {
  const normalized = userId.trim();
  if (!trackIdPattern.test(normalized)) {
    throw validationError("用户 ID 格式无效。");
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

function validateLimit(limit: number, maximum: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw validationError(`limit 必须是 1 至 ${maximum} 的整数。`);
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

function isExpectedAvailabilityFailure(error: AppError): boolean {
  return error.code === "TRACK_UNAVAILABLE"
    || error.code === "VIP_REQUIRED"
    || error.code === "REGION_RESTRICTED";
}

export class LegacyNeteaseAdapter {
  private readonly now: () => number;
  private readonly transportProxyUrl: string | undefined;

  constructor(
    private readonly api: LegacyNeteaseApi,
    options: LegacyAdapterOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.transportProxyUrl = options.transportProxyUrl;
  }

  private async invoke(
    method: LegacyApiMethod,
    params: Readonly<Record<string, unknown>>,
  ) {
    try {
      return await method(this.transportProxyUrl
        ? { ...params, proxy: this.transportProxyUrl }
        : params);
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
    const response = await this.invoke(this.api.cloudsearch, withCookie({
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

  async getHotSearches(limit: number): Promise<HotSearchTerm[]> {
    validateLimit(limit, 20);
    const response = await this.invoke(this.api.search_hot_detail, {});
    return mapHotSearches(unwrapLegacyBody(response).data, limit);
  }

  async getSimilarTracks(trackId: string, limit: number, cookie?: string): Promise<Track[]> {
    const id = validateTrackId(trackId);
    validateLimit(limit, 20);
    const response = await this.invoke(this.api.simi_song, withCookie({ id, limit }, cookie));
    return mapTracks(unwrapLegacyBody(response).songs).slice(0, limit);
  }

  async getAlbum(albumId: string): Promise<AlbumDetail> {
    const id = validateTrackId(albumId);
    const response = await this.invoke(this.api.album, { id });
    return mapAlbumDetail(unwrapLegacyBody(response));
  }

  async getArtist(artistId: string, page: PageQuery): Promise<ArtistDetail> {
    const id = validateTrackId(artistId);
    validatePage(page, 30);
    const [detailResponse, tracksResponse, albumsResponse] = await Promise.all([
      this.invoke(this.api.artist_detail, { id }),
      this.invoke(this.api.artist_top_song, { id }),
      this.invoke(this.api.artist_album, {
        id,
        limit: page.limit,
        offset: page.offset,
      }),
    ]);
    return mapArtistDetail(
      unwrapLegacyBody(detailResponse),
      unwrapLegacyBody(tracksResponse),
      unwrapLegacyBody(albumsResponse),
      page,
    );
  }

  async getNewSongs(limit: number): Promise<Track[]> {
    validateLimit(limit, 30);
    const response = await this.invoke(this.api.personalized_newsong, { limit });
    return mapNewSongs(unwrapLegacyBody(response)).slice(0, limit);
  }

  async getPopularPlaylists(page: PageQuery): Promise<CatalogPage<Playlist>> {
    validatePage(page, 30);
    const response = await this.invoke(this.api.top_playlist, {
      cat: "全部",
      limit: page.limit,
      offset: page.offset,
    });
    return mapPlaylistPage(unwrapLegacyBody(response), page);
  }

  async getPlaylist(playlistId: string, cookie?: string): Promise<PlaylistDetail> {
    const id = validateTrackId(playlistId);
    const response = await this.invoke(this.api.playlist_detail, withCookie({ id }, cookie));
    if (response.status === 404 || asRecord(response.body)?.code === 404) {
      throw new AppError("TRACK_UNAVAILABLE", "未找到这个歌单。", { retryable: false });
    }
    return mapPlaylistDetail(unwrapLegacyBody(response));
  }

  async getUserProfile(userId: string, cookie?: string): Promise<UserProfile> {
    const id = validateUserId(userId);
    const response = await this.invoke(this.api.user_detail, withCookie({ uid: id }, cookie));
    return mapUserProfile(unwrapLegacyBody(response));
  }

  async getUserPlaylists(
    userId: string,
    page: PageQuery,
    cookie?: string,
  ): Promise<UserPlaylistCollection> {
    const id = validateUserId(userId);
    validatePage(page, 30);
    const response = await this.invoke(this.api.user_playlist, withCookie({
      uid: id,
      limit: page.limit,
      offset: page.offset,
    }, cookie));
    return mapUserPlaylistCollection(unwrapLegacyBody(response), id);
  }

  async getLikedTracks(
    userId: string,
    page: PageQuery,
    cookie?: string,
  ): Promise<CatalogPage<Track>> {
    const id = validateUserId(userId);
    validatePage(page, 50);
    const likedResponse = await this.invoke(this.api.likelist, withCookie({
      uid: id,
    }, cookie));
    const likedBody = unwrapLegacyBody(likedResponse);
    const rawIds = Array.isArray(likedBody.ids) ? likedBody.ids : [];
    const ids = rawIds.flatMap((value) => {
      if (typeof value === "string" && /^\d{1,20}$/.test(value)) {
        return [value];
      }
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
        return [String(value)];
      }
      return [];
    });
    const selectedIds = ids.slice(page.offset, page.offset + page.limit);
    if (selectedIds.length === 0) {
      return {
        items: [],
        total: ids.length,
        limit: page.limit,
        offset: page.offset,
        hasMore: false,
      };
    }
    const detailResponse = await this.invoke(this.api.song_detail, withCookie({
      ids: selectedIds.join(","),
    }, cookie));
    const detailBody = unwrapLegacyBody(detailResponse);
    const items = mapTracks(detailBody.songs ?? []);
    return {
      items,
      total: ids.length,
      limit: page.limit,
      offset: page.offset,
      hasMore: page.offset + items.length < ids.length,
    };
  }

  async getLikedTrackIds(userId: string, cookie?: string): Promise<string[]> {
    const id = validateUserId(userId);
    const response = await this.invoke(this.api.likelist, withCookie({ uid: id }, cookie));
    const body = unwrapLegacyBody(response);
    if (!Array.isArray(body.ids)) {
      throw new AppError("UPSTREAM_UNAVAILABLE", "喜欢歌曲列表格式无效。", { retryable: true });
    }
    return [...new Set(body.ids.flatMap((value) => {
      if (typeof value === "string" && trackIdPattern.test(value)) return [value];
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return [String(value)];
      return [];
    }))];
  }

  async getSavedAlbums(
    page: PageQuery,
    cookie?: string,
  ): Promise<CatalogPage<AlbumSummary>> {
    validatePage(page, 50);
    const response = await this.invoke(this.api.album_sublist, withCookie({
      limit: page.limit,
      offset: page.offset,
    }, cookie));
    return mapSavedAlbumPage(unwrapLegacyBody(response), page);
  }

  async getPersonalDailyRecommendations(upstreamCookie: string): Promise<Track[]> {
    if (!upstreamCookie) {
      throw new AppError("AUTH_REQUIRED", "请先完成扫码登录后再查看个人日推。", {
        retryable: false,
      });
    }
    const response = await this.invoke(this.api.recommend_songs, {
      cookie: upstreamCookie,
    });
    const body = unwrapLegacyBody(response);
    const data = asRecord(body.data);
    return mapTracks(data?.dailySongs ?? data?.recommend ?? body.recommend ?? []);
  }

  async getPublicRecommendations(): Promise<Track[]> {
    const response = await this.invoke(this.api.top_song, { type: 0 });
    const body = unwrapLegacyBody(response);
    return mapTracks(body.data ?? []);
  }

  async getVerifiedPublicRecommendations(): Promise<Track[]> {
    const candidates = (await this.getPublicRecommendations())
      .slice(0, publicSelectionCandidateLimit);
    const verified: Track[] = [];
    let firstUnexpectedFailure: AppError | null = null;

    for (
      let offset = 0;
      offset < candidates.length && verified.length < publicSelectionTargetSize;
      offset += publicSelectionProbeConcurrency
    ) {
      const batch = candidates.slice(offset, offset + publicSelectionProbeConcurrency);
      const results = await Promise.all(batch.map(async (candidate) => {
        try {
          await this.getPlaybackSource(candidate.id, "standard");
          return { ...candidate, availability: "playable" as const };
        } catch (error) {
          const appError = safeUpstreamError(error);
          if (!isExpectedAvailabilityFailure(appError) && !firstUnexpectedFailure) {
            firstUnexpectedFailure = appError;
          }
          return null;
        }
      }));
      verified.push(...results.flatMap((track) => track ? [track] : []));
    }

    if (verified.length === 0 && firstUnexpectedFailure) {
      throw firstUnexpectedFailure;
    }

    return verified.slice(0, publicSelectionTargetSize);
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

  async createComment(input: CreateCommentInput, upstreamCookie: string): Promise<void> {
    const id = validateTrackId(input.trackId);
    const content = input.content.trim();
    if (!content || content.length > 1000) {
      throw validationError("评论参数无效。");
    }
    const replyToCommentId = input.replyToCommentId === undefined
      ? undefined
      : validateTrackId(input.replyToCommentId);
    if (!upstreamCookie) {
      throw new AppError("AUTH_REQUIRED", "请先完成扫码登录。", { retryable: false });
    }
    const response = await this.invoke(this.api.comment, {
      t: replyToCommentId ? 2 : 1,
      type: 0,
      id,
      ...(replyToCommentId ? { commentId: replyToCommentId } : {}),
      content,
      cookie: upstreamCookie,
    });
    const body = asRecord(response.body);
    if (response.status === 401 || body?.code === 401) {
      throw new AppError("SESSION_EXPIRED", "登录状态已失效，请重新扫码。", { retryable: false });
    }
    unwrapLegacyBody(response);
  }

  async setCommentLiked(
    trackId: string,
    commentId: string,
    liked: boolean,
    upstreamCookie: string,
  ): Promise<void> {
    const id = validateTrackId(trackId);
    const cid = validateTrackId(commentId);
    if (!upstreamCookie) {
      throw new AppError("AUTH_REQUIRED", "请先完成扫码登录。", { retryable: false });
    }
    const response = await this.invoke(this.api.comment_like, {
      id,
      cid,
      type: 0,
      t: liked ? 1 : 0,
      cookie: upstreamCookie,
    });
    const body = asRecord(response.body);
    if (response.status === 401 || body?.code === 401) {
      throw new AppError("SESSION_EXPIRED", "登录状态已失效，请重新扫码。", { retryable: false });
    }
    unwrapLegacyBody(response);
  }

  async setTrackLiked(
    trackId: string,
    liked: boolean,
    upstreamCookie: string,
  ): Promise<void> {
    const id = validateTrackId(trackId);
    if (!upstreamCookie) {
      throw new AppError("AUTH_REQUIRED", "请先完成扫码登录。", { retryable: false });
    }
    const response = await this.invoke(this.api.like, {
      id,
      like: liked ? 1 : 0,
      cookie: upstreamCookie,
    });
    unwrapLegacyBody(response);
  }

  async setAlbumCollected(
    albumId: string,
    collected: boolean,
    upstreamCookie: string,
  ): Promise<void> {
    const id = validateTrackId(albumId);
    if (!upstreamCookie) {
      throw new AppError("AUTH_REQUIRED", "请先完成扫码登录。", { retryable: false });
    }
    const response = await this.invoke(this.api.album_sub, {
      id,
      t: collected ? 1 : 0,
      cookie: upstreamCookie,
    });
    unwrapLegacyBody(response);
  }

  async createPlaylist(
    input: CreatePlaylistInput,
    upstreamCookie: string,
  ): Promise<Playlist> {
    const name = input.name.trim();
    if (!name || name.length > 40) {
      throw validationError("歌单名称长度必须是 1 至 40 个字符。");
    }
    if (!upstreamCookie) {
      throw new AppError("AUTH_REQUIRED", "请先完成扫码登录。", { retryable: false });
    }
    const response = await this.invoke(this.api.playlist_create, {
      name,
      privacy: input.visibility === "private" ? 10 : 0,
      type: "NORMAL",
      cookie: upstreamCookie,
    });
    const body = unwrapLegacyBody(response);
    const raw = asRecord(body.playlist ?? body.data);
    const id = raw?.id;
    const playlistId = typeof id === "number" && Number.isSafeInteger(id)
      ? String(id)
      : typeof id === "string" ? id : "";
    if (!trackIdPattern.test(playlistId)) {
      throw new AppError("UPSTREAM_UNAVAILABLE", "歌单创建结果无法识别。", { retryable: true });
    }
    const mapped = mapPlaylist(raw);
    if (mapped) {
      return { ...mapped, visibility: raw?.privacy === undefined ? input.visibility : mapped.visibility };
    }
    return {
      id: playlistId,
      name,
      description: null,
      tags: [],
      artworkUrl: null,
      owner: null,
      visibility: input.visibility,
      trackCount: 0,
      createdAt: null,
      updatedAt: null,
    };
  }

  async changePlaylistTracks(
    input: ChangePlaylistTracksInput,
    upstreamCookie: string,
  ): Promise<void> {
    const playlistId = validateTrackId(input.playlistId);
    if (!upstreamCookie) {
      throw new AppError("AUTH_REQUIRED", "请先完成扫码登录。", { retryable: false });
    }
    const trackIds = input.trackIds.map(validateTrackId);
    if (trackIds.length === 0 || trackIds.length > 100) {
      throw validationError("曲目数量必须是 1 至 100 首。");
    }
    const response = await this.invoke(this.api.playlist_tracks, {
      op: input.operation === "add" ? "add" : "del",
      pid: playlistId,
      tracks: trackIds.join(","),
      cookie: upstreamCookie,
    });
    const outer = asRecord(response.body);
    const nested = outer ? asRecord(outer.body) : null;
    const body = nested ?? outer;
    if (response.status !== 200 || body?.code !== 200) {
      throw new AppError("UPSTREAM_UNAVAILABLE", "歌单曲目操作未完成。", { retryable: true });
    }
  }

  async updatePlaylist(input: UpdatePlaylistInput, upstreamCookie: string): Promise<void> {
    const id = validateTrackId(input.playlistId);
    if (!upstreamCookie) {
      throw new AppError("AUTH_REQUIRED", "请先完成扫码登录。", { retryable: false });
    }
    const { update } = input;
    const method = update.field === "name" ? this.api.playlist_name_update
      : update.field === "description" ? this.api.playlist_desc_update
        : update.field === "tags" ? this.api.playlist_tags_update
          : this.api.playlist_privacy;
    const fields = update.field === "name" ? { name: update.value }
      : update.field === "description" ? { desc: update.value }
        : update.field === "tags" ? { tags: update.value.join(",") }
          : {};
    const response = await this.invoke(method, { id, ...fields, cookie: upstreamCookie });
    unwrapLegacyBody(response);
  }

  async deletePlaylist(
    input: DeletePlaylistInput,
    upstreamCookie: string,
  ): Promise<void> {
    const playlistId = validateTrackId(input.playlistId);
    if (!upstreamCookie) {
      throw new AppError("AUTH_REQUIRED", "请先完成扫码登录。", { retryable: false });
    }
    const response = await this.invoke(this.api.playlist_delete, {
      id: playlistId,
      cookie: upstreamCookie,
    });
    unwrapLegacyBody(response);
  }

  async startQrLogin(): Promise<LegacyQrChallenge> {
    const keyResponse = await this.invoke(this.api.login_qr_key, {});
    const keyBody = unwrapLegacyBody(keyResponse);
    const keyData = keyBody.data;
    if (!keyData || typeof keyData !== "object" || Array.isArray(keyData)) {
      throw new AppError("UPSTREAM_UNAVAILABLE", "二维码暂时无法生成。", {
        retryable: true,
      });
    }
    const key = (keyData as Record<string, unknown>).unikey;
    if (typeof key !== "string" || !key.trim() || key.length > 256) {
      throw new AppError("UPSTREAM_UNAVAILABLE", "二维码暂时无法生成。", {
        retryable: true,
      });
    }
    const imageResponse = await this.invoke(this.api.login_qr_create, {
      key,
      qrimg: true,
    });
    return mapQrChallenge(keyBody, unwrapLegacyBody(imageResponse));
  }

  async pollQrCode(key: string): Promise<LegacyQrPollResult> {
    if (!key || key.length > 256) {
      throw validationError("二维码凭据格式无效。");
    }
    const response = await this.invoke(this.api.login_qr_check, { key });
    return mapQrPollResult(unwrapLegacyQrBody(response));
  }

  async getSessionUser(upstreamCookie: string) {
    if (!upstreamCookie) {
      return null;
    }
    const response = await this.invoke(this.api.login_status, {
      cookie: upstreamCookie,
    });
    return mapSessionUser(response);
  }

  async logout(upstreamCookie: string): Promise<void> {
    if (!upstreamCookie) {
      return;
    }
    await this.invoke(this.api.logout, { cookie: upstreamCookie });
  }
}
