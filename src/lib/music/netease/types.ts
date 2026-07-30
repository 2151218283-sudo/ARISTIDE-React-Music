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
  check_music: LegacyApiMethod;
  comment_music: LegacyApiMethod;
  login_qr_check: LegacyApiMethod;
  lyric_new: LegacyApiMethod;
  search: LegacyApiMethod;
  song_detail: LegacyApiMethod;
  song_url_v1: LegacyApiMethod;
}

export interface LegacyAdapterOptions {
  now?: () => number;
}

export type LegacyQrPollResult =
  | { status: "expired" }
  | { status: "waiting" }
  | { status: "scanned" }
  | { status: "authorized"; upstreamCookie: string };

export interface LegacySearchFailure {
  code: AppErrorCode;
  retryable: boolean;
}
