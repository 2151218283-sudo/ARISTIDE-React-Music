import type {
  AudioQuality,
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  CatalogPage,
  ChangePlaylistTracksInput,
  CommentPage,
  CreateCommentInput,
  CreatePlaylistInput,
  UpdatePlaylistInput,
  LyricDocument,
  PageQuery,
  DeletePlaylistInput,
  PlaybackSource,
  Playlist,
  PlaylistDetail,
  QrChallenge,
  QrLoginState,
  SearchQuery,
  SearchResponse,
  Track,
  UserProfile,
  UserPlaylistCollection,
} from "./models";

export interface MusicProvider {
  startQrLogin(sessionId: string): Promise<QrChallenge>;
  pollQrLogin(sessionId: string): Promise<QrLoginState>;
  getSessionUser(sessionId: string): Promise<UserProfile | null>;
  logout(sessionId: string): Promise<void>;

  getUserProfile(userId: string, sessionId?: string): Promise<UserProfile>;
  getUserPlaylists(
    userId: string,
    page: PageQuery,
    sessionId?: string,
  ): Promise<UserPlaylistCollection>;
  getLikedTracks(
    userId: string,
    page: PageQuery,
    sessionId?: string,
  ): Promise<CatalogPage<Track>>;
  getSavedAlbums(
    page: PageQuery,
    sessionId?: string,
  ): Promise<CatalogPage<AlbumSummary>>;

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
  getPlaylist(playlistId: string, sessionId?: string): Promise<PlaylistDetail>;
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
  setAlbumCollected(
    albumId: string,
    collected: boolean,
    sessionId: string,
  ): Promise<void>;
  createPlaylist(
    input: CreatePlaylistInput,
    sessionId: string,
  ): Promise<Playlist>;
  updatePlaylist(input: UpdatePlaylistInput, sessionId: string): Promise<void>;
  changePlaylistTracks(
    input: ChangePlaylistTracksInput,
    sessionId: string,
  ): Promise<void>;
  deletePlaylist(
    input: DeletePlaylistInput,
    sessionId: string,
  ): Promise<void>;
  createComment(
    input: CreateCommentInput,
    sessionId: string,
  ): Promise<void>;
  setCommentLiked(
    trackId: string,
    commentId: string,
    liked: boolean,
    sessionId: string,
  ): Promise<void>;
}
