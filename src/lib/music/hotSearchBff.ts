import { randomUUID } from "node:crypto";

import { createApiFailure, createApiSuccess } from "./apiResult";
import { AppError, isAppError } from "./errors";
import type { HotSearchTerm } from "./models";
import { readSessionIdFromRequest, type InMemorySessionStore } from "../session/sessionStore";

export interface HotSearchDependencies {
  createProvider: () => { getHotSearches(limit: number): Promise<HotSearchTerm[]> };
  store: InMemorySessionStore;
  now?: () => number;
  createRequestId?: () => string;
  timeoutMs?: number;
}

async function withTimeout<T>(execute: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError(
      "UPSTREAM_TIMEOUT", "热搜读取超时，请稍后重试。", { retryable: true },
    )), timeoutMs);
  });
  try {
    return await Promise.race([execute(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createHotSearchHandler({
  createProvider,
  store,
  now = Date.now,
  createRequestId = randomUUID,
  timeoutMs = 10_000,
}: HotSearchDependencies) {
  return async (request: Request): Promise<Response> => {
    const requestId = createRequestId();
    const sessionId = readSessionIdFromRequest(request);
    const mode = sessionId && store.getPublicState(sessionId)?.mode === "demo" ? "demo" : "real";
    try {
      const items = mode === "demo" ? [] : await withTimeout(
        () => createProvider().getHotSearches(10), timeoutMs,
      );
      return Response.json(createApiSuccess({ source: mode, items }, {
        requestId,
        mode,
        fetchedAt: new Date(now()).toISOString(),
      }), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const failure = isAppError(error) ? error
        : new AppError("UPSTREAM_UNAVAILABLE", "热搜暂时不可用。", { retryable: true });
      return Response.json(createApiFailure(failure, requestId), {
        status: failure.code === "RATE_LIMITED" ? 429
          : failure.code === "UPSTREAM_TIMEOUT" ? 504 : 502,
        headers: { "Cache-Control": "no-store" },
      });
    }
  };
}
