import { LegacyNeteaseAdapter } from "./adapter";
import { loadLegacyNeteaseApi } from "./legacyApi.server";
import type { LegacyAdapterOptions } from "./types";

export function createLegacyNeteaseAdapter(
  options: LegacyAdapterOptions = {},
): LegacyNeteaseAdapter {
  return new LegacyNeteaseAdapter(loadLegacyNeteaseApi(), options);
}

export { LegacyNeteaseAdapter } from "./adapter";
export type {
  LegacyAdapterOptions,
  LegacyQrChallenge,
  LegacyQrPollResult,
} from "./types";
