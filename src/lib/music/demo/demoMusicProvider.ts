import {
  demoCommentsByTrackId,
  demoLyricsByTrackId,
  demoTracks,
} from "../../../data/demo/musicCatalog";
import { AppError } from "../errors";
import type {
  AlbumSummary,
  ArtistSummary,
  AudioQuality,
  ChangePlaylistTracksInput,
  Comment,
  CommentPage,
  CreateCommentInput,
  CreatePlaylistInput,
  LyricDocument,
  PageQuery,
  PlaybackSource,
  Playlist,
  QrChallenge,
  QrLoginState,
  SearchQuery,
  SearchResponse,
  Track,
  UserProfile,
} from "../models";
import type { MusicProvider } from "../provider";

export const demoScenarios = [
  "normal",
  "empty",
  "timeout",
  "upstream-error",
  "unplayable",
  "no-lyrics",
  "no-comments",
] as const;

export type DemoScenario = (typeof demoScenarios)[number];

export interface DemoMusicProviderOptions {
  scenario?: DemoScenario;
  seed?: string;
}

function cloneUserProfile(profile: UserProfile): UserProfile {
  return { ...profile };
}

function cloneComment(comment: Comment): Comment {
  return {
    ...comment,
    author: cloneUserProfile(comment.author),
    replyTo: comment.replyTo ? { ...comment.replyTo } : null,
  };
}

function cloneLyricDocument(document: LyricDocument): LyricDocument {
  return {
    kind: document.kind,
    lines: document.lines.map((line) => ({
      ...line,
      words: line.words?.map((word) => ({ ...word })) ?? null,
    })),
  };
}

function cloneTrack(track: Track): Track {
  return {
    ...track,
    artists: track.artists.map((artist) => ({ ...artist })),
    album: { ...track.album },
    aliases: [...track.aliases],
    privilege: { ...track.privilege },
  };
}

function hashSeed(seed: string): number {
  let hash = 2_166_136_261;

  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

function shuffleWithSeed<T>(items: readonly T[], seed: string): T[] {
  const shuffled = [...items];
  let state = hashSeed(seed) || 1;

  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const targetIndex = Math.floor(next() * (index + 1));
    [shuffled[index], shuffled[targetIndex]] = [
      shuffled[targetIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

function validatePageQuery(query: PageQuery): void {
  if (
    !Number.isInteger(query.limit)
    || query.limit < 1
    || query.limit > 100
    || !Number.isInteger(query.offset)
    || query.offset < 0
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "分页参数无效，请调整后重试。",
    );
  }
}

function matchesText(values: string[], searchText: string): boolean {
  return values.some((value) => value.toLocaleLowerCase().includes(searchText));
}

function uniqueArtists(tracks: Track[]): ArtistSummary[] {
  const artists = new Map<string, ArtistSummary>();

  for (const track of tracks) {
    for (const artist of track.artists) {
      if (!artists.has(artist.id)) {
        artists.set(artist.id, { ...artist });
      }
    }
  }

  return [...artists.values()];
}

function uniqueAlbums(tracks: Track[]): AlbumSummary[] {
  const albums = new Map<string, AlbumSummary>();

  for (const track of tracks) {
    if (!albums.has(track.album.id)) {
      albums.set(track.album.id, { ...track.album });
    }
  }

  return [...albums.values()];
}

function throwDemoWriteUnavailable(): never {
  throw new AppError(
    "AUTH_REQUIRED",
    "演示模式不提供真实账号写入，请切回 Real Mode 并登录。",
  );
}

export class DemoMusicProvider implements MusicProvider {
  private readonly scenario: DemoScenario;
  private readonly seed: string;

  constructor(options: DemoMusicProviderOptions = {}) {
    this.scenario = options.scenario ?? "normal";
    this.seed = options.seed ?? "echoform-demo";
  }

  async startQrLogin(sessionId: string): Promise<QrChallenge> {
    void sessionId;
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "演示模式不提供扫码登录，请切回 Real Mode。",
    );
  }

  async pollQrLogin(sessionId: string): Promise<QrLoginState> {
    void sessionId;
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "演示模式不提供扫码登录，请切回 Real Mode。",
    );
  }

  async getSessionUser(sessionId: string): Promise<UserProfile | null> {
    void sessionId;
    return null;
  }

  async logout(sessionId: string): Promise<void> {
    void sessionId;
  }

  async getDailyRecommendations(sessionId: string): Promise<Track[]> {
    void sessionId;
    this.assertReadScenarioAvailable();

    return shuffleWithSeed(this.getScenarioTracks(), this.seed);
  }

  async search(query: SearchQuery, sessionId?: string): Promise<SearchResponse> {
    void sessionId;
    this.assertReadScenarioAvailable();
    validatePageQuery(query);

    const text = query.text.trim().toLocaleLowerCase();
    const tracks = text.length === 0
      ? []
      : this.getScenarioTracks().filter((track) => matchesText([
          track.name,
          ...track.aliases,
          track.album.name,
          ...track.artists.map((artist) => artist.name),
        ], text));
    const artists = uniqueArtists(this.getScenarioTracks()).filter((artist) => (
      text.length > 0 && matchesText([artist.name], text)
    ));
    const albums = uniqueAlbums(this.getScenarioTracks()).filter((album) => (
      text.length > 0 && matchesText([album.name], text)
    ));

    if (query.type === "all") {
      return {
        type: "all",
        tracks: this.createSection(tracks, Math.min(query.limit, 5)),
        artists: this.createSection(artists, Math.min(query.limit, 4)),
        albums: this.createSection(albums, Math.min(query.limit, 4)),
        partialErrors: [],
      };
    }

    if (query.type === "track") {
      return {
        type: "track",
        ...this.createPage(tracks, query),
      };
    }

    if (query.type === "artist") {
      return {
        type: "artist",
        ...this.createPage(artists, query),
      };
    }

    return {
      type: "album",
      ...this.createPage(albums, query),
    };
  }

  async getTrack(trackId: string, sessionId?: string): Promise<Track> {
    void sessionId;
    this.assertReadScenarioAvailable();

    const track = this.getScenarioTracks().find((item) => item.id === trackId);

    if (!track) {
      throw new AppError(
        "TRACK_UNAVAILABLE",
        "未找到这首演示曲目，请返回并选择其他歌曲。",
        { details: { trackId } },
      );
    }

    return cloneTrack(track);
  }

  async getPlaybackSource(
    trackId: string,
    quality: AudioQuality,
    sessionId?: string,
  ): Promise<PlaybackSource> {
    void quality;
    const track = await this.getTrack(trackId, sessionId);

    if (track.availability === "vip") {
      throw new AppError("VIP_REQUIRED", "这首歌曲需要会员权限。", {
        details: { trackId },
      });
    }

    if (track.availability === "region") {
      throw new AppError("REGION_RESTRICTED", "这首歌曲受地区限制。", {
        details: { trackId },
      });
    }

    throw new AppError(
      "TRACK_UNAVAILABLE",
      "当前没有已授权的本地演示音频，请返回并选择其他内容。",
      { details: { trackId } },
    );
  }

  async getLyrics(trackId: string, sessionId?: string): Promise<LyricDocument> {
    void sessionId;
    this.assertReadScenarioAvailable();

    if (this.scenario === "empty" || this.scenario === "no-lyrics") {
      return { kind: "unavailable", lines: [] };
    }

    await this.getTrack(trackId, sessionId);
    const document = demoLyricsByTrackId[trackId];

    return document
      ? cloneLyricDocument(document)
      : { kind: "unavailable", lines: [] };
  }

  async getComments(trackId: string, page: PageQuery): Promise<CommentPage> {
    this.assertReadScenarioAvailable();
    validatePageQuery(page);

    if (this.scenario === "empty" || this.scenario === "no-comments") {
      return {
        ...page,
        items: [],
        total: 0,
        hasMore: false,
      };
    }

    await this.getTrack(trackId);
    const comments = (demoCommentsByTrackId[trackId] ?? []).map(cloneComment);
    const items = comments.slice(page.offset, page.offset + page.limit);

    return {
      ...page,
      items,
      total: comments.length,
      hasMore: page.offset + items.length < comments.length,
    };
  }

  async setTrackLiked(
    trackId: string,
    liked: boolean,
    sessionId: string,
  ): Promise<void> {
    void trackId;
    void liked;
    void sessionId;
    throwDemoWriteUnavailable();
  }

  async createPlaylist(
    input: CreatePlaylistInput,
    sessionId: string,
  ): Promise<Playlist> {
    void input;
    void sessionId;
    return throwDemoWriteUnavailable();
  }

  async changePlaylistTracks(
    input: ChangePlaylistTracksInput,
    sessionId: string,
  ): Promise<void> {
    void input;
    void sessionId;
    throwDemoWriteUnavailable();
  }

  async createComment(
    input: CreateCommentInput,
    sessionId: string,
  ): Promise<Comment> {
    void input;
    void sessionId;
    return throwDemoWriteUnavailable();
  }

  private assertReadScenarioAvailable(): void {
    if (this.scenario === "timeout") {
      throw new AppError(
        "UPSTREAM_TIMEOUT",
        "演示请求超时，请重试。",
        { retryable: true },
      );
    }

    if (this.scenario === "upstream-error") {
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        "演示上游暂不可用，请重试。",
        { retryable: true },
      );
    }
  }

  private createPage<T>(items: T[], query: PageQuery) {
    const pageItems = items.slice(query.offset, query.offset + query.limit);

    return {
      items: pageItems,
      total: items.length,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + pageItems.length < items.length,
    };
  }

  private createSection<T>(items: T[], limit: number) {
    const sectionItems = items.slice(0, limit);

    return {
      items: sectionItems,
      total: items.length,
      hasMore: sectionItems.length < items.length,
    };
  }

  private getScenarioTracks(): Track[] {
    if (this.scenario === "empty") {
      return [];
    }

    return demoTracks.map((track) => {
      const cloned = cloneTrack(track);

      if (this.scenario === "unplayable") {
        cloned.availability = "copyright";
      }

      return cloned;
    });
  }
}
