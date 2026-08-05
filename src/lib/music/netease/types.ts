import type { AppErrorCode } from "../errors";

export interface LegacyApiResponse {
  status: unknown;
  body: unknown;
  cookie?: unknown;
}

export type LegacyApiMethod = (
  params: Readonly<Record<string, unknown>>,
) => Promise<LegacyApiResponse>;

export interface LegacyNeteaseApi {
  album: LegacyApiMethod;
  artist_album: LegacyApiMethod;
  artist_detail: LegacyApiMethod;
  artist_top_song: LegacyApiMethod;
  check_music: LegacyApiMethod;
  comment_music: LegacyApiMethod;
  login_qr_create: LegacyApiMethod;
  login_qr_check: LegacyApiMethod;
  login_qr_key: LegacyApiMethod;
  login_status: LegacyApiMethod;
  lyric_new: LegacyApiMethod;
  logout: LegacyApiMethod;
  search: LegacyApiMethod;
  recommend_songs: LegacyApiMethod;
  personalized_newsong: LegacyApiMethod;
  song_detail: LegacyApiMethod;
  song_url_v1: LegacyApiMethod;
  top_playlist: LegacyApiMethod;
  top_song: LegacyApiMethod;
}

export interface LegacyAdapterOptions {
  now?: () => number;
  transportProxyUrl?: string;
}

export type LegacyQrPollResult =
  | { status: "expired" }
  | { status: "waiting" }
  | { status: "scanned" }
  | { status: "authorized"; upstreamCookie: string };

export interface LegacyQrChallenge {
  key: string;
  qrImageDataUrl: string;
}

export interface LegacySearchFailure {
  code: AppErrorCode;
  retryable: boolean;
}
