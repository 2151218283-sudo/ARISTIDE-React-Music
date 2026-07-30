import { LegacyNeteaseAdapter } from "./adapter";
import { readNeteaseTransportProxyUrl } from "./config.server";
import { loadLegacyNeteaseApi } from "./legacyApi.server";
import type { LegacyAdapterOptions } from "./types";

export function createLegacyNeteaseAdapter(
  options: LegacyAdapterOptions = {},
): LegacyNeteaseAdapter {
  return new LegacyNeteaseAdapter(loadLegacyNeteaseApi(), {
    ...options,
    transportProxyUrl: options.transportProxyUrl ?? readNeteaseTransportProxyUrl(),
  });
}

export { LegacyNeteaseAdapter } from "./adapter";
export type {
  LegacyAdapterOptions,
  LegacyQrChallenge,
  LegacyQrPollResult,
} from "./types";
