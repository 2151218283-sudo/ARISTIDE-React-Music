import { randomUUID } from "node:crypto";

import { createApiFailure, createApiSuccess } from "./apiResult";
import { AppError, isAppError, type AppErrorCode } from "./errors";
import type {
  ChangePlaylistTracksInput,
  CreatePlaylistInput,
  DeletePlaylistInput,
  Playlist,
  PlaylistDetail,
  PlaylistUpdate,
  UpdatePlaylistInput,
} from "./models";
import { InMemorySessionStore, SESSION_COOKIE_NAME, type ServerSession } from "../session/sessionStore";

const entityIdPattern = /^\d{1,20}$/;
const demoEntityIdPattern = /^demo-[A-Za-z0-9_-]{1,64}$/;
const mutationIdPattern = /^[A-Za-z0-9_-]{16,128}$/;
const noStore = "no-store";

export interface PlaylistProvider {
  getPlaylist(id: string, credential?: string): Promise<PlaylistDetail>;
  createPlaylist(input: CreatePlaylistInput, credential: string): Promise<Playlist>;
  changePlaylistTracks(input: ChangePlaylistTracksInput, credential: string): Promise<void>;
  deletePlaylist(input: DeletePlaylistInput, credential: string): Promise<void>;
  updatePlaylist(input: UpdatePlaylistInput, credential: string): Promise<void>;
}

export interface PlaylistRouteHandlers {
  detail(request: Request, playlistId: string): Promise<Response>;
  create(request: Request): Promise<Response>;
  tracks(request: Request, playlistId: string): Promise<Response>;
  update(request: Request, playlistId: string): Promise<Response>;
  delete(request: Request, playlistId: string): Promise<Response>;
}

export interface PlaylistRouteDependencies {
  store: InMemorySessionStore;
  createRealProvider: () => PlaylistProvider;
  createDemoProvider: () => PlaylistProvider;
  createRequestId?: () => string;
  now?: () => number;
  timeoutMs?: number;
}

interface Context {
  provider: PlaylistProvider;
  session: ServerSession;
  credential?: string;
  userId?: string;
  mode: "real" | "demo";
}

function errorFrom(error: unknown): AppError {
  return isAppError(error)
    ? error
    : new AppError("UNKNOWN_ERROR", "请求未能完成，请稍后重试。", { retryable: true });
}

function statusFor(code: AppErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR": return 400;
    case "AUTH_REQUIRED":
    case "SESSION_EXPIRED": return 401;
    case "USER_NOT_FOUND": return 404;
    case "TRACK_UNAVAILABLE": return 404;
    case "RATE_LIMITED": return 429;
    case "UPSTREAM_TIMEOUT": return 504;
    case "UPSTREAM_UNAVAILABLE":
    case "NETWORK_ERROR": return 502;
    default: return 500;
  }
}

function respond(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": noStore,
      "X-Request-Id": body && typeof body === "object" && "ok" in body && body.ok === true
        ? String((body as { meta?: { requestId?: string } }).meta?.requestId ?? "")
        : body && typeof body === "object" && "error" in body
          ? String((body as { error?: { requestId?: string } }).error?.requestId ?? "")
          : "",
    },
  });
}

function parseId(value: string, mode: "real" | "demo" = "real"): string {
  const id = value.trim();
  if (!entityIdPattern.test(id) && !(mode === "demo" && demoEntityIdPattern.test(id))) {
    throw new AppError("VALIDATION_ERROR", "歌单 ID 格式无效。", { retryable: false });
  }
  return id;
}

function parseSessionId(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return value.join("=") || null;
  }
  return null;
}

function contextFor(request: Request, dependencies: PlaylistRouteDependencies): Context {
  const sessionId = parseSessionId(request);
  const session = sessionId ? dependencies.store.get(sessionId) : null;
  if (!session) {
    throw new AppError("AUTH_REQUIRED", "请先完成扫码登录。", { retryable: false });
  }
  if (session.mode === "demo") {
    return { mode: "demo", provider: dependencies.createDemoProvider(), session, credential: session.id };
  }
  if (!session.user || !session.upstreamCookie) {
    throw new AppError("AUTH_REQUIRED", "请先完成扫码登录。", { retryable: false });
  }
  return {
    mode: "real",
    provider: dependencies.createRealProvider(),
    session,
    credential: session.upstreamCookie,
    userId: session.user.id,
  };
}

async function body(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try { parsed = await request.json(); } catch {
    throw new AppError("VALIDATION_ERROR", "写入参数无效。", { retryable: false });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError("VALIDATION_ERROR", "写入参数无效。", { retryable: false });
  }
  return parsed as Record<string, unknown>;
}

function mutationId(value: unknown): string {
  if (typeof value !== "string" || !mutationIdPattern.test(value)) {
    throw new AppError("VALIDATION_ERROR", "clientMutationId 格式无效。", { retryable: false });
  }
  return value;
}

function parseUpdate(parsed: Record<string, unknown>): PlaylistUpdate {
  if (parsed.field === "publish" && parsed.value === undefined) return { field: "publish" };
  if (parsed.field === "name" && typeof parsed.value === "string") {
    const name = parsed.value.trim();
    if (name.length >= 1 && name.length <= 40) return { field: "name", value: name };
  }
  if (parsed.field === "description" && typeof parsed.value === "string") {
    const description = parsed.value.trim();
    if (description.length <= 1000) return { field: "description", value: description };
  }
  if (parsed.field === "tags" && Array.isArray(parsed.value)) {
    const tags = parsed.value;
    if (tags.length <= 3 && tags.every((tag) => typeof tag === "string"
      && tag.trim().length >= 1 && tag.trim().length <= 20 && !tag.includes(","))) {
      const normalized = tags.map((tag: string) => tag.trim());
      if (new Set(normalized).size === normalized.length) return { field: "tags", value: normalized };
    }
  }
  throw new AppError("VALIDATION_ERROR", "歌单编辑参数无效。", { retryable: false });
}

async function withTimeout<T>(execute: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError("UPSTREAM_TIMEOUT", "上游响应超时，请稍后重试。", { retryable: true })), timeoutMs);
  });
  try { return await Promise.race([execute(), timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

function detailAccess(detail: PlaylistDetail, context: Context): void {
  if (context.mode === "real" && detail.playlist.visibility === "private" && detail.playlist.owner?.id !== context.userId) {
    throw new AppError("AUTH_REQUIRED", "该歌单未公开，或当前账号没有查看权限。", { retryable: false });
  }
}

export function createPlaylistRouteHandlers(input: PlaylistRouteDependencies): PlaylistRouteHandlers {
  const dependencies = {
    ...input,
    createRequestId: input.createRequestId ?? randomUUID,
    now: input.now ?? Date.now,
    timeoutMs: input.timeoutMs ?? 15_000,
  };
  const inFlight = new Map<string, { operation: string; promise: Promise<unknown> }>();

  const failure = (error: unknown, requestId: string): Response => {
    const appError = errorFrom(error);
    return respond(createApiFailure(appError, requestId), statusFor(appError.code));
  };

  async function mutation<T>(
    parsed: Record<string, unknown>,
    context: Context,
    operation: string,
    execute: (clientMutationId: string) => Promise<T>,
  ): Promise<Response> {
    const clientMutationId = mutationId(parsed.clientMutationId);
    const existing = dependencies.store.getLibraryMutation(context.session.id, clientMutationId);
    if (existing) {
      if (existing.operation !== operation) {
        throw new AppError("VALIDATION_ERROR", "clientMutationId 已用于其他写操作。", { retryable: false });
      }
      return respond(createApiSuccess(existing.result as T, {
        requestId: dependencies.createRequestId(), mode: context.mode, fetchedAt: new Date(dependencies.now()).toISOString(),
      }), 200);
    }
    const key = `${context.session.id}:${clientMutationId}`;
    const pending = inFlight.get(key);
    if (pending && pending.operation !== operation) {
      throw new AppError("VALIDATION_ERROR", "clientMutationId 已用于其他写操作。", { retryable: false });
    }
    const promise = pending?.promise ?? (async () => {
      const result = await withTimeout(() => execute(clientMutationId), dependencies.timeoutMs);
      if (!dependencies.store.setLibraryMutation(context.session.id, clientMutationId, operation, result)) {
        throw new AppError("SESSION_EXPIRED", "登录状态已失效，请重新扫码。", { retryable: false });
      }
      return result;
    })();
    if (!pending) inFlight.set(key, { operation, promise });
    let result: T;
    try { result = await promise as T; }
    finally { if (!pending) inFlight.delete(key); }
    return respond(createApiSuccess(result, {
      requestId: dependencies.createRequestId(), mode: context.mode, fetchedAt: new Date(dependencies.now()).toISOString(),
    }), 200);
  }

  return {
    async detail(request, rawId) {
      const requestId = dependencies.createRequestId();
      try {
        const sessionId = parseSessionId(request);
        const session = sessionId ? dependencies.store.get(sessionId) : null;
        const id = parseId(rawId, session?.mode);
        const provider = session?.mode === "demo"
          ? dependencies.createDemoProvider()
          : dependencies.createRealProvider();
        const detail = await withTimeout(() => provider.getPlaylist(id, session?.upstreamCookie ?? undefined), dependencies.timeoutMs);
        if (detail.playlist.visibility === "private" && !session) {
          throw new AppError("AUTH_REQUIRED", "该歌单未公开，或当前账号没有查看权限。", { retryable: false });
        }
        if (session) detailAccess(detail, {
          mode: session.mode,
          provider,
          session,
          credential: session.upstreamCookie ?? undefined,
          userId: session.user?.id,
        });
        const readableDetail = {
          ...detail,
          canEdit: session?.mode === "real"
            && detail.canEdit
            && detail.playlist.owner?.id === session.user?.id,
        };
        return respond(createApiSuccess(readableDetail, {
          requestId, mode: session?.mode ?? "real", fetchedAt: new Date(dependencies.now()).toISOString(),
        }), 200);
      } catch (error) { return failure(error, requestId); }
    },
    async create(request) {
      const requestId = dependencies.createRequestId();
      try {
        const context = contextFor(request, dependencies);
        const parsed = await body(request);
        const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
        const visibility = parsed.visibility === "private" ? "private" : parsed.visibility === "public" ? "public" : null;
        if (!name || name.length > 40 || !visibility) throw new AppError("VALIDATION_ERROR", "歌单名称或公开状态无效。", { retryable: false });
        const input: CreatePlaylistInput = { name, visibility, clientMutationId: mutationId(parsed.clientMutationId) };
        return await mutation(parsed, context, `playlist-create:${name}:${visibility}`, (clientMutationId) => context.provider.createPlaylist({ ...input, clientMutationId }, context.credential ?? ""));
      } catch (error) { return failure(error, requestId); }
    },
    async tracks(request, rawId) {
      const requestId = dependencies.createRequestId();
      try {
        const context = contextFor(request, dependencies);
        const playlistId = parseId(rawId);
        const parsed = await body(request);
        const operation = parsed.operation === "add" || parsed.operation === "remove" ? parsed.operation : null;
        const trackIds = parsed.trackIds;
        if (!operation || !Array.isArray(trackIds) || trackIds.length < 1 || trackIds.length > 100
          || trackIds.some((id) => typeof id !== "string" || !entityIdPattern.test(id))) {
          throw new AppError("VALIDATION_ERROR", "曲目参数无效。", { retryable: false });
        }
        const input: ChangePlaylistTracksInput = { playlistId, trackIds, operation, clientMutationId: mutationId(parsed.clientMutationId) };
        return await mutation(parsed, context, `playlist-tracks:${playlistId}:${operation}:${trackIds.join(",")}`, async (clientMutationId) => {
          const detail = await withTimeout(() => context.provider.getPlaylist(playlistId, context.credential), dependencies.timeoutMs);
          if (!detail.canEdit || detail.playlist.owner?.id !== context.userId) {
            throw new AppError("AUTH_REQUIRED", "只有歌单所有者可以修改曲目。", { retryable: false });
          }
          await context.provider.changePlaylistTracks({ ...input, clientMutationId }, context.credential ?? "");
          return { playlistId, operation, trackIds };
        });
      } catch (error) { return failure(error, requestId); }
    },
    async update(request, rawId) {
      const requestId = dependencies.createRequestId();
      try {
        const context = contextFor(request, dependencies);
        const playlistId = parseId(rawId);
        const parsed = await body(request);
        const update = parseUpdate(parsed);
        const input: UpdatePlaylistInput = { playlistId, update, clientMutationId: mutationId(parsed.clientMutationId) };
        return await mutation(parsed, context, `playlist-update:${playlistId}:${JSON.stringify(update)}`, async (clientMutationId) => {
          const detail = await withTimeout(() => context.provider.getPlaylist(playlistId, context.credential), dependencies.timeoutMs);
          if (!detail.canEdit || detail.playlist.owner?.id !== context.userId) {
            throw new AppError("AUTH_REQUIRED", "只有歌单所有者可以编辑歌单。", { retryable: false });
          }
          if (update.field === "publish" && detail.playlist.visibility !== "private") {
            throw new AppError("VALIDATION_ERROR", "该歌单已经公开。", { retryable: false });
          }
          await context.provider.updatePlaylist({ ...input, clientMutationId }, context.credential ?? "");
          return { playlistId, ...update };
        });
      } catch (error) { return failure(error, requestId); }
    },
    async delete(request, rawId) {
      const requestId = dependencies.createRequestId();
      try {
        const context = contextFor(request, dependencies);
        const playlistId = parseId(rawId);
        const parsed = await body(request);
        const input: DeletePlaylistInput = { playlistId, clientMutationId: mutationId(parsed.clientMutationId) };
        return await mutation(parsed, context, `playlist-delete:${playlistId}`, async (clientMutationId) => {
          const detail = await withTimeout(() => context.provider.getPlaylist(playlistId, context.credential), dependencies.timeoutMs);
          if (!detail.canEdit || detail.playlist.owner?.id !== context.userId) {
            throw new AppError("AUTH_REQUIRED", "只有歌单所有者可以删除歌单。", { retryable: false });
          }
          await context.provider.deletePlaylist({ ...input, clientMutationId }, context.credential ?? "");
          return { playlistId, deleted: true as const };
        });
      } catch (error) { return failure(error, requestId); }
    },
  };
}
