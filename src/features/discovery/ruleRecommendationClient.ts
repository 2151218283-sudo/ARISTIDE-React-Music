"use client";

import type { LocalHistorySeed, RuleRecommendations } from "@/lib/music/models";

export class RuleRecommendationClientError extends Error {
  constructor(readonly retryable: boolean, message: string, readonly requiresLogin = false) {
    super(message);
    this.name = "RuleRecommendationClientError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function requestRuleRecommendations(
  history: readonly LocalHistorySeed[],
  signal?: AbortSignal,
): Promise<RuleRecommendations> {
  let response: Response;
  try {
    response = await fetch("/api/recommendations/rules", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history }),
      signal,
    });
  } catch {
    throw new RuleRecommendationClientError(true, "无法连接规则推荐服务，请重试。");
  }
  let body: unknown;
  try { body = await response.json(); } catch {
    throw new RuleRecommendationClientError(true, "规则推荐响应无法读取，请重试。");
  }
  if (!response.ok || !isRecord(body) || body.ok !== true || !isRecord(body.data)) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : null;
    throw new RuleRecommendationClientError(error?.retryable === true,
      typeof error?.message === "string" ? error.message : "规则推荐暂时不可用。",
      response.status === 401 && (error?.code === "AUTH_REQUIRED" || error?.code === "SESSION_EXPIRED"));
  }
  const data = body.data;
  if (data.source !== "real" || typeof data.date !== "string"
    || typeof data.historySampleSize !== "number" || typeof data.likedSampleSize !== "number"
    || typeof data.failedSeedCount !== "number"
    || typeof data.failedAvailabilityCount !== "number" || !Array.isArray(data.items)
    || !data.items.every((item) => isRecord(item) && isRecord(item.track)
      && typeof item.track.id === "string" && typeof item.track.name === "string"
      && item.track.availability === "playable" && typeof item.score === "number"
      && Array.isArray(item.reasons)
      && item.reasons.every((reason) => isRecord(reason)
        && typeof reason.seedId === "string" && typeof reason.seedName === "string"
        && (reason.source === "liked" || reason.source === "local-history")))) {
    throw new RuleRecommendationClientError(true, "规则推荐数据格式无效，请重试。");
  }
  return data as unknown as RuleRecommendations;
}
