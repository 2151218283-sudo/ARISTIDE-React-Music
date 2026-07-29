export const appErrorCodes = [
  "AUTH_REQUIRED",
  "SESSION_EXPIRED",
  "QR_EXPIRED",
  "VALIDATION_ERROR",
  "TRACK_UNAVAILABLE",
  "VIP_REQUIRED",
  "REGION_RESTRICTED",
  "SOURCE_EXPIRED",
  "RATE_LIMITED",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_UNAVAILABLE",
  "NETWORK_ERROR",
  "UNKNOWN_ERROR",
] as const;

export type AppErrorCode = (typeof appErrorCodes)[number];
export type AppErrorDetailValue = string | number | boolean;
export type AppErrorDetails = Readonly<Record<string, AppErrorDetailValue>>;

export interface AppErrorOptions {
  details?: AppErrorDetails;
  retryable?: boolean;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: AppErrorDetails;
  readonly retryable: boolean;

  constructor(
    code: AppErrorCode,
    message: string,
    options: AppErrorOptions = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function normalizeUnknownError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  return new AppError(
    "UNKNOWN_ERROR",
    "请求未能完成，请稍后重试。",
    { retryable: true },
  );
}
