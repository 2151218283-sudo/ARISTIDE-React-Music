import type {
  AudioQuality,
  AlbumDetail,
  ArtistDetail,
  CatalogPage,
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
} from "./models";

export interface MusicProvider {
  startQrLogin(sessionId: string): Promise<QrChallenge>;
  pollQrLogin(sessionId: string): Promise<QrLoginState>;
  getSessionUser(sessionId: string): Promise<UserProfile | null>;
  logout(sessionId: string): Promise<void>;

  getDailyRecommendations(sessionId: string): Promise<Track[]>;
  search(query: SearchQuery, sessionId?: string): Promise<SearchResponse>;
  getAlbum(albumId: string, sessionId?: string): Promise<AlbumDetail>;
  getArtist(
    artistId: string,
    page: PageQuery,
    sessionId?: string,
  ): Promise<ArtistDetail>;
  getNewSongs(limit: number, sessionId?: string): Promise<Track[]>;
  getPopularPlaylists(
    page: PageQuery,
    sessionId?: string,
  ): Promise<CatalogPage<Playlist>>;
  getTrack(trackId: string, sessionId?: string): Promise<Track>;
  getPlaybackSource(
    trackId: string,
    quality: AudioQuality,
    sessionId?: string,
  ): Promise<PlaybackSource>;
  getLyrics(trackId: string, sessionId?: string): Promise<LyricDocument>;
  getComments(trackId: string, page: PageQuery): Promise<CommentPage>;

  setTrackLiked(
    trackId: string,
    liked: boolean,
    sessionId: string,
  ): Promise<void>;
  createPlaylist(
    input: CreatePlaylistInput,
    sessionId: string,
  ): Promise<Playlist>;
  changePlaylistTracks(
    input: ChangePlaylistTracksInput,
    sessionId: string,
  ): Promise<void>;
  createComment(
    input: CreateCommentInput,
    sessionId: string,
  ): Promise<Comment>;
}
