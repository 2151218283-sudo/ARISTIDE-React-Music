import { createRequire } from "node:module";

import type {
  LegacyApiMethod,
  LegacyNeteaseApi,
} from "./types";

const requiredMethods = [
  "album",
  "artist_album",
  "artist_detail",
  "artist_top_song",
  "check_music",
  "comment_music",
  "cloudsearch",
  "login_qr_create",
  "login_qr_check",
  "login_qr_key",
  "login_status",
  "lyric_new",
  "logout",
  "personalized_newsong",
  "recommend_songs",
  "song_detail",
  "song_url_v1",
  "top_playlist",
  "top_song",
  "user_detail",
  "user_playlist",
] as const satisfies readonly (keyof LegacyNeteaseApi)[];

let cachedApi: LegacyNeteaseApi | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function loadLegacyNeteaseApi(): LegacyNeteaseApi {
  if (cachedApi) {
    return cachedApi;
  }
  if (typeof window !== "undefined") {
    throw new Error("Legacy Netease API can only be loaded on the server.");
  }

  const require = createRequire(import.meta.url);
  const candidate: unknown = require("NeteaseCloudMusicApi");
  if (!isRecord(candidate)) {
    throw new Error("Legacy Netease API module shape is invalid.");
  }

  const entries = requiredMethods.map((name) => {
    const method = candidate[name];
    if (typeof method !== "function") {
      throw new Error(`Legacy Netease API method is missing: ${name}`);
    }
    return [name, method as LegacyApiMethod] as const;
  });
  cachedApi = Object.fromEntries(entries) as unknown as LegacyNeteaseApi;
  return cachedApi;
}
