"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  DailyRecommendations,
  DataMode,
} from "@/lib/music/models";

interface ApiSuccess<T> {
  ok: true;
  data: T;
}

interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface DailyRecommendationError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface UseDailyRecommendationsOptions {
  enabled: boolean;
  mode: DataMode;
  userId: string | null;
}

export interface DailyRecommendationState {
  data: DailyRecommendations | null;
  error: DailyRecommendationError | null;
  status: "loading" | "ready" | "error";
}

function scopeFor(options: UseDailyRecommendationsOptions): string {
  return `${options.mode}:${options.userId ?? "guest"}`;
}

export function useDailyRecommendations(
  options: UseDailyRecommendationsOptions,
): DailyRecommendationState & { retry(): void } {
  const [requestVersion, setRequestVersion] = useState(0);
  const scope = scopeFor(options);
  const scopeRef = useRef(scope);
  const [state, setState] = useState<DailyRecommendationState>({
    data: null,
    error: null,
    status: "loading",
  });

  useEffect(() => {
    if (!options.enabled) {
      return;
    }

    const controller = new AbortController();
    const scopeChanged = scopeRef.current !== scope;
    scopeRef.current = scope;
    setState((previous) => ({
      data: scopeChanged ? null : previous.data,
      error: null,
      status: "loading",
    }));

    const load = async () => {
      try {
        const response = await fetch("/api/recommendations/daily", {
          signal: controller.signal,
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const body = await response.json() as ApiResponse<DailyRecommendations>;
        if (!response.ok || !body.ok) {
          if (!body.ok) {
            throw body.error;
          }
          throw {
            code: "UNKNOWN_ERROR",
            message: "今日推荐暂时不可用，请稍后重试。",
            retryable: true,
          } satisfies DailyRecommendationError;
        }
        if (!controller.signal.aborted) {
          setState({ data: body.data, error: null, status: "ready" });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        const normalized = isDailyRecommendationError(error)
          ? error
          : {
            code: "NETWORK_ERROR",
            message: "无法连接今日推荐服务，请检查网络后重试。",
            retryable: true,
          };
        setState((previous) => ({
          data: scopeChanged ? null : previous.data,
          error: normalized,
          status: "error",
        }));
      }
    };

    void load();
    return () => controller.abort();
  }, [options.enabled, requestVersion, scope]);

  const retry = useCallback(() => {
    setRequestVersion((version) => version + 1);
  }, []);

  return { ...state, retry };
}

function isDailyRecommendationError(
  error: unknown,
): error is DailyRecommendationError {
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return false;
  }
  const candidate = error as Partial<DailyRecommendationError>;
  return typeof candidate.code === "string"
    && typeof candidate.message === "string"
    && typeof candidate.retryable === "boolean";
}
