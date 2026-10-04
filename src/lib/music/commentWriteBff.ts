import { createHmac, randomUUID } from "node:crypto";

import { createApiFailure, createApiSuccess } from "./apiResult";
import { AppError, isAppError, type AppErrorCode } from "./errors";
import type { CreateCommentInput } from "./models";
import { InMemorySessionStore, SESSION_COOKIE_NAME } from "../session/sessionStore";

const entityIdPattern = /^\d{1,20}$/;
const mutationIdPattern = /^[A-Za-z0-9_-]{16,128}$/;

interface WriteResult {
  accepted: boolean;
}

export interface CommentWriteProvider {
  createComment(input: CreateCommentInput, credential: string): Promise<void>;
  setCommentLiked(trackId: string, commentId: string, liked: boolean, credential: string): Promise<void>;
}

export interface CommentWriteDependencies {
  store: InMemorySessionStore;
  createProvider: () => CommentWriteProvider;
  createRequestId?: () => string;
  now?: () => number;
  timeoutMs?: number;
}

function sessionIdFrom(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return value.join("=") || null;
  }
  return null;
}

function statusFor(code: AppErrorCode): number {
  if (code === "VALIDATION_ERROR") return 400;
  if (code === "AUTH_REQUIRED" || code === "SESSION_EXPIRED") return 401;
  if (code === "RATE_LIMITED") return 429;
  if (code === "UPSTREAM_TIMEOUT") return 504;
  if (code === "UPSTREAM_UNAVAILABLE" || code === "NETWORK_ERROR") return 502;
  return 500;
}

function uncertainError(): AppError {
  return new AppError("UPSTREAM_TIMEOUT", "提交结果尚未确认，请刷新评论列表检查。", { retryable: false });
}

function parseBody(request: Request): Promise<Omit<CreateCommentInput, "trackId">> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new AppError("VALIDATION_ERROR", "评论参数必须使用 JSON。", { retryable: false });
  }
  return request.json().catch(() => null).then((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AppError("VALIDATION_ERROR", "评论参数无效。", { retryable: false });
    }
    const body = value as Record<string, unknown>;
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content || content.length > 1000) {
      throw new AppError("VALIDATION_ERROR", "评论正文须为 1 至 1000 个字符。", { retryable: false });
    }
    if (body.replyToCommentId !== undefined
      && (typeof body.replyToCommentId !== "string" || !entityIdPattern.test(body.replyToCommentId))) {
      throw new AppError("VALIDATION_ERROR", "回复评论 ID 格式无效。", { retryable: false });
    }
    if (typeof body.clientMutationId !== "string" || !mutationIdPattern.test(body.clientMutationId)) {
      throw new AppError("VALIDATION_ERROR", "clientMutationId 格式无效。", { retryable: false });
    }
    return {
      content,
      clientMutationId: body.clientMutationId,
      ...(typeof body.replyToCommentId === "string" ? { replyToCommentId: body.replyToCommentId } : {}),
    };
  });
}

async function parseLikeMutationId(request: Request): Promise<string> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new AppError("VALIDATION_ERROR", "写入参数必须使用 JSON。", { retryable: false });
  }
  const body: unknown = await request.json().catch(() => null);
  const id = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).clientMutationId : null;
  if (typeof id !== "string" || !mutationIdPattern.test(id)) {
    throw new AppError("VALIDATION_ERROR", "clientMutationId 格式无效。", { retryable: false });
  }
  return id;
}

function operationFor(trackId: string, content: string, credential: string, replyToCommentId?: string): string {
  const digest = createHmac("sha256", credential).update(content).digest("hex");
  return `comment-create:${trackId}:${replyToCommentId ?? "top"}:${digest}`;
}

export function createCommentWriteRouteHandler(input: CommentWriteDependencies) {
  const createRequestId = input.createRequestId ?? randomUUID;
  const now = input.now ?? Date.now;
  const timeoutMs = input.timeoutMs ?? 15_000;
  const inFlight = new Map<string, { operation: string; promise: Promise<WriteResult> }>();

  async function write(
    request: Request,
    rawTrackId: string,
    parse: (request: Request, trackId: string, credential: string) => Promise<{
      clientMutationId: string;
      operation: string;
      execute: (credential: string) => Promise<void>;
    }>,
  ): Promise<Response> {
    const requestId = createRequestId();
    const respond = (result: WriteResult): Response => Response.json(createApiSuccess(result, {
      requestId, mode: "real", fetchedAt: new Date(now()).toISOString(),
    }), { status: 200, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });

    try {
      const sessionId = sessionIdFrom(request);
      const session = sessionId ? input.store.get(sessionId) : null;
      if (!session || session.mode !== "real" || !session.user || !session.upstreamCookie) {
        throw new AppError("AUTH_REQUIRED", "请先完成扫码登录。", { retryable: false });
      }
      const trackId = rawTrackId.trim();
      if (!entityIdPattern.test(trackId)) {
        throw new AppError("VALIDATION_ERROR", "歌曲 ID 格式无效。", { retryable: false });
      }
      const parsed = await parse(request, trackId, session.upstreamCookie);
      const operation = `${session.user.id}:${parsed.operation}`;
      const existing = input.store.getLibraryMutation(session.id, parsed.clientMutationId);
      if (existing) {
        if (existing.operation !== operation) {
          throw new AppError("VALIDATION_ERROR", "clientMutationId 已用于其他写操作。", { retryable: false });
        }
        if ((existing.result as WriteResult).accepted) return respond({ accepted: true });
        throw uncertainError();
      }

      const key = `${session.id}:${parsed.clientMutationId}`;
      const pending = inFlight.get(key);
      if (pending && pending.operation !== operation) {
        throw new AppError("VALIDATION_ERROR", "clientMutationId 已用于其他写操作。", { retryable: false });
      }
      const promise = pending?.promise ?? parsed.execute(session.upstreamCookie)
        .then((): WriteResult => {
          input.store.setLibraryMutation(session.id, parsed.clientMutationId, operation, { accepted: true });
          return { accepted: true };
        })
        .catch((error: unknown): never => {
          if (!isAppError(error) || !["VALIDATION_ERROR", "AUTH_REQUIRED", "SESSION_EXPIRED", "RATE_LIMITED"].includes(error.code)) {
            input.store.setLibraryMutation(session.id, parsed.clientMutationId, operation, { accepted: false });
          }
          throw error;
        })
        .finally(() => inFlight.delete(key));
      if (!pending) inFlight.set(key, { operation, promise });

      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              input.store.setLibraryMutation(session.id, parsed.clientMutationId, operation, { accepted: false });
              reject(uncertainError());
            }, timeoutMs);
          }),
        ]);
        return respond(result);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (error) {
      const appError = isAppError(error)
        ? error
        : new AppError("UPSTREAM_UNAVAILABLE", "评论操作未能确认，请刷新列表检查。", { retryable: false });
      return Response.json(createApiFailure(appError, requestId), {
        status: statusFor(appError.code),
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      });
    }
  }

  return {
    post: (request: Request, rawTrackId: string) => write(request, rawTrackId, async (currentRequest, trackId, credential) => {
      const parsed = await parseBody(currentRequest);
      return {
        clientMutationId: parsed.clientMutationId,
        operation: operationFor(trackId, parsed.content, credential, parsed.replyToCommentId),
        execute: (credential: string) => input.createProvider().createComment({ ...parsed, trackId }, credential),
      };
    }),
    like: (request: Request, rawTrackId: string, rawCommentId: string, liked: boolean) => write(
      request,
      rawTrackId,
      async (currentRequest, trackId) => {
        if (!entityIdPattern.test(rawCommentId)) {
          throw new AppError("VALIDATION_ERROR", "评论 ID 格式无效。", { retryable: false });
        }
        const clientMutationId = await parseLikeMutationId(currentRequest);
        return {
          clientMutationId,
          operation: `comment-like:${trackId}:${rawCommentId}:${liked ? "put" : "delete"}`,
          execute: (credential: string) => input.createProvider().setCommentLiked(trackId, rawCommentId, liked, credential),
        };
      },
    ),
  };
}
