export const appErrorCodes = [
  "AUTH_REQUIRED",
  "SESSION_EXPIRED",
  "USER_NOT_FOUND",
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
export const publicAppErrorDetailKeys = ["trackId"] as const;
export type PublicAppErrorDetailKey = (typeof publicAppErrorDetailKeys)[number];
export type AppErrorDetails = Readonly<
  Partial<Record<PublicAppErrorDetailKey, AppErrorDetailValue>>
>;

const stableEntityIdPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

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

export function sanitizePublicAppErrorDetails(
  details: AppErrorDetails | undefined,
): AppErrorDetails | undefined {
  if (!details) {
    return undefined;
  }

  const trackId = details.trackId;

  if (typeof trackId === "string" && stableEntityIdPattern.test(trackId)) {
    return { trackId };
  }

  return undefined;
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
