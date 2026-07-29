import {
  normalizeUnknownError,
  type AppErrorCode,
  type AppErrorDetails,
} from "./errors";
import type { DataMode } from "./models";

export interface ApiMeta {
  requestId: string;
  mode: DataMode;
  fetchedAt: string;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiFailureBody {
  code: AppErrorCode;
  message: string;
  retryable: boolean;
  requestId: string;
  details?: AppErrorDetails;
}

export interface ApiFailure {
  ok: false;
  error: ApiFailureBody;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export function createApiSuccess<T>(
  data: T,
  meta?: ApiMeta,
): ApiSuccess<T> {
  if (!meta) {
    return { ok: true, data };
  }

  return { ok: true, data, meta };
}

export function createApiFailure(
  error: unknown,
  requestId: string,
): ApiFailure {
  const appError = normalizeUnknownError(error);
  const body: ApiFailureBody = {
    code: appError.code,
    message: appError.message,
    retryable: appError.retryable,
    requestId,
  };

  if (appError.details) {
    body.details = appError.details;
  }

  return { ok: false, error: body };
}
