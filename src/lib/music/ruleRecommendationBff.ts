import { createHash, randomUUID } from "node:crypto";

import { createApiFailure, createApiSuccess } from "./apiResult";
import { AppError, isAppError } from "./errors";
import type {
  LocalHistorySeed,
  PlaybackSource,
  RuleRecommendations,
  Track,
} from "./models";
import {
  limitRecommendedArtists,
  rankSimilarTracks,
  selectRuleSeeds,
  type SimilarSeedResult,
} from "./ruleRecommendation";
import { readSessionIdFromRequest, type InMemorySessionStore } from "../session/sessionStore";

const trackIdPattern = /^\d{1,20}$/;
const historyWindowMs = 30 * 24 * 60 * 60 * 1_000;
const recentRepeatMs = 7 * 24 * 60 * 60 * 1_000;
const candidateProbeLimit = 24;

export interface RuleRecommendationProvider {
  getLikedTrackIds(userId: string, cookie?: string): Promise<string[]>;
  getTrack(trackId: string, cookie?: string): Promise<Track>;
  getSimilarTracks(trackId: string, limit: number, cookie?: string): Promise<Track[]>;
  getPlaybackSource(trackId: string, quality: "standard", cookie?: string): Promise<PlaybackSource>;
}

export interface RuleRecommendationDependencies {
  createProvider: () => RuleRecommendationProvider;
  store: InMemorySessionStore;
  now?: () => number;
  createRequestId?: () => string;
  timeoutMs?: { default: number; source: number };
}

async function withTimeout<T>(execute: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError(
      "UPSTREAM_TIMEOUT", "上游响应超时，请稍后重试。", { retryable: true },
    )), timeoutMs);
  });
  try {
    return await Promise.race([execute(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function localDate(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseHistory(value: unknown, now: number): LocalHistorySeed[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new AppError("VALIDATION_ERROR", "本地播放记录参数无效。", { retryable: false });
  }
  const latest = new Map<string, number>();
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new AppError("VALIDATION_ERROR", "本地播放记录参数无效。", { retryable: false });
    }
    const row = item as Record<string, unknown>;
    if (typeof row.trackId !== "string" || !trackIdPattern.test(row.trackId)
      || typeof row.playedAt !== "number" || !Number.isSafeInteger(row.playedAt)
      || row.playedAt > now + 60_000 || row.playedAt < now - historyWindowMs) {
      throw new AppError("VALIDATION_ERROR", "本地播放记录参数无效。", { retryable: false });
    }
    latest.set(row.trackId, Math.max(latest.get(row.trackId) ?? 0, row.playedAt));
  }
  return [...latest].map(([trackId, playedAt]) => ({ trackId, playedAt }))
    .sort((left, right) => right.playedAt - left.playedAt
    || left.trackId.localeCompare(right.trackId));
}

function responseError(error: unknown, requestId: string): Response {
  const failure = isAppError(error)
    ? error
    : new AppError("UPSTREAM_UNAVAILABLE", "规则推荐暂时不可用。", { retryable: true });
  const status = failure.code === "AUTH_REQUIRED" || failure.code === "SESSION_EXPIRED" ? 401
    : failure.code === "VALIDATION_ERROR" ? 400
      : failure.code === "UPSTREAM_TIMEOUT" ? 504 : 502;
  return Response.json(createApiFailure(failure, requestId), {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isExpectedUnavailable(error: unknown): boolean {
  return isAppError(error) && (
    error.code === "TRACK_UNAVAILABLE"
    || error.code === "VIP_REQUIRED"
    || error.code === "REGION_RESTRICTED"
  );
}

function isAuthenticationFailure(error: unknown): error is AppError {
  return isAppError(error) && (
    error.code === "AUTH_REQUIRED" || error.code === "SESSION_EXPIRED"
  );
}

export function createRuleRecommendationRouteHandlers({
  createProvider,
  store,
  now = Date.now,
  createRequestId = randomUUID,
  timeoutMs = { default: 10_000, source: 15_000 },
}: RuleRecommendationDependencies) {
  return {
    async rules(request: Request): Promise<Response> {
      const requestId = createRequestId();
      try {
        const sessionId = readSessionIdFromRequest(request);
        const session = sessionId ? store.get(sessionId) : null;
        if (!session || session.mode !== "real" || !session.user || !session.upstreamCookie) {
          throw new AppError("AUTH_REQUIRED", "登录 Real Mode 后才能查看规则推荐。", { retryable: false });
        }
        const userId = session.user.id;
        const credential = session.upstreamCookie;
        const assertCurrentSession = (): void => {
          const current = store.get(session.id);
          if (current?.mode !== "real" || current.user?.id !== userId
            || current.upstreamCookie !== credential) {
            throw new AppError("SESSION_EXPIRED", "登录状态已变化，请重新加载推荐。", { retryable: false });
          }
        };
        let input: unknown;
        try { input = await request.json(); } catch {
          throw new AppError("VALIDATION_ERROR", "规则推荐参数无效。", { retryable: false });
        }
        if (typeof input !== "object" || input === null || Array.isArray(input)) {
          throw new AppError("VALIDATION_ERROR", "规则推荐参数无效。", { retryable: false });
        }
        const currentTime = now();
        const history = parseHistory((input as Record<string, unknown>).history, currentTime);
        const provider = createProvider();
        const likedIds = await withTimeout(
          () => provider.getLikedTrackIds(userId, credential),
          timeoutMs.default,
        );
        assertCurrentSession();
        const date = localDate(currentTime);
        const seeds = selectRuleSeeds(history, likedIds, date, userId);
        const fingerprint = createHash("sha256").update(JSON.stringify({
          likedIds: [...likedIds].sort(),
          history,
          seeds,
        })).digest("hex");
        const cacheKey = `real:${userId}:${date}:${fingerprint}`;
        const cached = store.getRuleRecommendations(session.id, cacheKey);
        if (cached) {
          return Response.json(createApiSuccess(cached, {
            requestId, mode: "real", fetchedAt: new Date(currentTime).toISOString(),
          }), { headers: { "Cache-Control": "no-store" } });
        }

        const groups: SimilarSeedResult[] = [];
        let failedSeedCount = 0;
        for (let offset = 0; offset < seeds.length; offset += 3) {
          const batch = await Promise.allSettled(seeds.slice(offset, offset + 3).map(async (seed) => {
            const track = await withTimeout(
              () => provider.getTrack(seed.trackId, credential),
              timeoutMs.default,
            );
            const tracks = await withTimeout(
              () => provider.getSimilarTracks(seed.trackId, 20, credential),
              timeoutMs.default,
            );
            return { seed, seedName: track.name, tracks };
          }));
          for (const result of batch) {
            if (result.status === "fulfilled") groups.push(result.value);
            else {
              if (isAuthenticationFailure(result.reason)) throw result.reason;
              failedSeedCount += 1;
            }
          }
        }
        assertCurrentSession();
        if (seeds.length > 0 && groups.length === 0) {
          throw new AppError("UPSTREAM_UNAVAILABLE", "相似歌曲读取全部失败，请稍后重试。", { retryable: true });
        }
        const excluded = new Set([...likedIds, ...seeds.map((seed) => seed.trackId)]);
        history.filter((entry) => entry.playedAt >= currentTime - recentRepeatMs)
          .forEach((entry) => excluded.add(entry.trackId));
        const ranked = rankSimilarTracks(groups, excluded).slice(0, candidateProbeLimit);
        const verified: typeof ranked = [];
        let failedAvailabilityCount = 0;
        for (let offset = 0; offset < ranked.length; offset += 3) {
          const batch = await Promise.all(ranked.slice(offset, offset + 3).map(async (item) => {
            try {
              await withTimeout(
                () => provider.getPlaybackSource(item.track.id, "standard", credential),
                timeoutMs.source,
              );
              return { ...item, track: { ...item.track, availability: "playable" as const } };
            } catch (error) {
              if (isAuthenticationFailure(error)) throw error;
              if (!isExpectedUnavailable(error)) failedAvailabilityCount += 1;
              return null;
            }
          }));
          verified.push(...batch.filter((item): item is NonNullable<typeof item> => item !== null));
          if (limitRecommendedArtists(verified).length >= 12) break;
        }
        assertCurrentSession();
        if (verified.length === 0 && failedAvailabilityCount > 0) {
          throw new AppError("UPSTREAM_UNAVAILABLE", "可播性验证暂时失败，请稍后重试。", { retryable: true });
        }
        const data: RuleRecommendations = {
          date,
          source: "real",
          historyWindowDays: 30,
          historySampleSize: history.length,
          likedSampleSize: likedIds.length,
          failedSeedCount,
          failedAvailabilityCount,
          items: limitRecommendedArtists(verified),
        };
        assertCurrentSession();
        if (failedSeedCount === 0 && failedAvailabilityCount === 0) {
          store.setRuleRecommendations(session.id, cacheKey, data);
        }
        return Response.json(createApiSuccess(data, {
          requestId, mode: "real", fetchedAt: new Date(currentTime).toISOString(),
        }), { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        return responseError(error, requestId);
      }
    },
  };
}
