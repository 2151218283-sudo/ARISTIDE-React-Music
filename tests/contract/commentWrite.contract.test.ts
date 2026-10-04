import { describe, expect, it, vi } from "vitest";

import { createCommentWriteRouteHandler } from "../../src/lib/music/commentWriteBff";
import { AppError } from "../../src/lib/music/errors";
import type { CreateCommentInput } from "../../src/lib/music/models";
import { LegacyNeteaseAdapter } from "../../src/lib/music/netease/adapter";
import type { LegacyNeteaseApi } from "../../src/lib/music/netease/types";
import { InMemorySessionStore, SESSION_COOKIE_NAME } from "../../src/lib/session/sessionStore";

const mutationId = "synthetic-comment-mutation-0001";

function setup(createComment = vi.fn<(input: CreateCommentInput, credential: string) => Promise<void>>(async () => {}), timeoutMs = 15_000) {
  const store = new InMemorySessionStore();
  const session = store.create();
  session.user = { id: "701", nickname: "Synthetic Listener", avatarUrl: null, signature: null };
  session.upstreamCookie = "server-only-credential";
  const setCommentLiked = vi.fn(async () => {});
  const handlers = createCommentWriteRouteHandler({
    store,
    createProvider: () => ({ createComment, setCommentLiked }),
    timeoutMs,
  });
  const post = handlers.post;
  const request = (body: unknown, authenticated = true) => new Request("https://echoform.test/api/tracks/101/comments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { Cookie: `${SESSION_COOKIE_NAME}=${session.id}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { post, request, createComment, setCommentLiked, handlers, store, session };
}

describe("comment write contract", () => {
  it("requires server authentication and validates body without calling upstream", async () => {
    const { post, request, createComment } = setup();
    expect((await post(request({ content: "hello", clientMutationId: mutationId }, false), "101")).status).toBe(401);
    expect((await post(request({ content: " ", clientMutationId: mutationId }), "101")).status).toBe(400);
    expect((await post(request({ content: "hello", replyToCommentId: "bad", clientMutationId: mutationId }), "101")).status).toBe(400);
    expect((await post(request({ content: "hello", clientMutationId: mutationId }), "bad-id")).status).toBe(400);
    expect(createComment).not.toHaveBeenCalled();
  });

  it("coalesces concurrent IDs, returns confirmed duplicates, and rejects ID reuse", async () => {
    let release = () => {};
    const createComment = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const { post, request, store, session } = setup(createComment);
    const body = { content: "Synthetic comment", clientMutationId: mutationId };
    const first = post(request(body), "101");
    const second = post(request(body), "101");
    await vi.waitFor(() => expect(createComment).toHaveBeenCalledTimes(1));
    release();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect((await post(request(body), "101")).status).toBe(200);
    expect((await post(request({ ...body, content: "Different" }), "101")).status).toBe(400);
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(store.getLibraryMutation(session.id, mutationId))).not.toContain(body.content);
  });

  it("never resends an ambiguous timed-out operation", async () => {
    const createComment = vi.fn(() => new Promise<void>(() => {}));
    const { post, request } = setup(createComment, 1);
    const body = { content: "Synthetic comment", clientMutationId: mutationId };
    expect((await post(request(body), "101")).status).toBe(504);
    expect((await post(request(body), "101")).status).toBe(504);
    expect(createComment).toHaveBeenCalledTimes(1);
  });

  it("allows a deliberate new attempt after a definite 429 rejection", async () => {
    const createComment = vi.fn()
      .mockRejectedValueOnce(new AppError("RATE_LIMITED", "Too many requests", { retryable: true }))
      .mockResolvedValueOnce(undefined);
    const { post, request } = setup(createComment);
    const body = { content: "Synthetic comment", clientMutationId: mutationId };
    expect((await post(request(body), "101")).status).toBe(429);
    expect((await post(request(body), "101")).status).toBe(200);
    expect(createComment).toHaveBeenCalledTimes(2);
  });

  it("sends only the verified top-level payload and checks business success", async () => {
    const comment = vi.fn(async () => ({ status: 200, body: { code: 200 } }));
    const adapter = new LegacyNeteaseAdapter({ comment } as unknown as LegacyNeteaseApi);
    const input = { trackId: "101", content: "Synthetic comment", clientMutationId: mutationId };
    await adapter.createComment(input, "server-only-credential");
    expect(comment).toHaveBeenCalledWith({
      t: 1, type: 0, id: "101", content: input.content, cookie: "server-only-credential",
    });
    comment.mockResolvedValueOnce({ status: 429, body: { code: 429 } });
    await expect(adapter.createComment(input, "server-only-credential")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("binds reply mutation IDs to their exact parent and forwards the verified upstream payload", async () => {
    const { post, request, createComment } = setup();
    const body = { content: "Synthetic reply", replyToCommentId: "801", clientMutationId: mutationId };
    expect((await post(request(body), "101")).status).toBe(200);
    expect(createComment).toHaveBeenCalledWith({ trackId: "101", ...body }, "server-only-credential");
    expect((await post(request({ ...body, replyToCommentId: "802" }), "101")).status).toBe(400);

    const comment = vi.fn(async () => ({ status: 200, body: { code: 200 } }));
    const adapter = new LegacyNeteaseAdapter({ comment } as unknown as LegacyNeteaseApi);
    await adapter.createComment({ trackId: "101", ...body }, "server-only-credential");
    expect(comment).toHaveBeenCalledWith({
      t: 2, type: 0, id: "101", commentId: "801", content: body.content, cookie: "server-only-credential",
    });
  });

  it("deduplicates comment like, checks comment IDs, and separates like from unlike", async () => {
    const { handlers, request, setCommentLiked } = setup();
    const body = { clientMutationId: mutationId };
    expect((await handlers.like(request(body, false), "101", "801", true)).status).toBe(401);
    expect((await handlers.like(request(body), "101", "bad", true)).status).toBe(400);
    expect((await handlers.like(request(body), "101", "801", true)).status).toBe(200);
    expect((await handlers.like(request(body), "101", "801", true)).status).toBe(200);
    expect((await handlers.like(request(body), "101", "801", false)).status).toBe(400);
    expect(setCommentLiked).toHaveBeenCalledTimes(1);
    expect(setCommentLiked).toHaveBeenCalledWith("101", "801", true, "server-only-credential");
    expect((await handlers.like(request({ clientMutationId: "synthetic-comment-unlike-0001" }), "101", "801", false)).status).toBe(200);
    expect(setCommentLiked).toHaveBeenCalledWith("101", "801", false, "server-only-credential");
  });

  it("rejects reusing a comment mutation ID for a like without a second upstream write", async () => {
    const { post, request, handlers, createComment, setCommentLiked } = setup();
    expect((await post(request({ content: "Synthetic comment", clientMutationId: mutationId }), "101")).status).toBe(200);
    expect((await handlers.like(request({ clientMutationId: mutationId }), "101", "801", true)).status).toBe(400);
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(setCommentLiked).not.toHaveBeenCalled();
  });

  it("treats a timed-out like as uncertain and never resends it", async () => {
    const { handlers, request, setCommentLiked } = setup(undefined, 1);
    setCommentLiked.mockImplementation(() => new Promise<void>(() => {}));
    const body = { clientMutationId: mutationId };
    expect((await handlers.like(request(body), "101", "801", true)).status).toBe(504);
    expect((await handlers.like(request(body), "101", "801", true)).status).toBe(504);
    expect(setCommentLiked).toHaveBeenCalledTimes(1);
  });

  it("maps comment like and unlike to the pinned Legacy methods", async () => {
    const comment_like = vi.fn(async () => ({ status: 200, body: { code: 200 } }));
    const adapter = new LegacyNeteaseAdapter({ comment_like } as unknown as LegacyNeteaseApi);
    await adapter.setCommentLiked("101", "801", true, "server-only-credential");
    await adapter.setCommentLiked("101", "801", false, "server-only-credential");
    expect(comment_like).toHaveBeenNthCalledWith(1, { id: "101", cid: "801", type: 0, t: 1, cookie: "server-only-credential" });
    expect(comment_like).toHaveBeenNthCalledWith(2, { id: "101", cid: "801", type: 0, t: 0, cookie: "server-only-credential" });
  });
});
