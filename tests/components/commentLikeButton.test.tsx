// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommentLikeButton } from "../../src/features/player/CommentLikeButton";
import type { Comment } from "../../src/lib/music/models";

const auth = vi.hoisted(() => ({
  state: {
    mode: "real" as "real" | "demo",
    status: "ready" as "ready" | "loading",
    user: null as { id: string; nickname: string } | null,
    openLogin: vi.fn(),
  },
}));

vi.mock("../../src/features/auth/AuthProvider", () => ({ useAuth: () => auth.state }));

const comment: Comment = {
  id: "801",
  author: { id: "702", nickname: "Synthetic Author", avatarUrl: null, signature: null },
  content: "Synthetic comment",
  createdAt: 1_735_689_600_000,
  likedCount: 4,
  likedByCurrentUser: false,
  replyTo: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  auth.state.mode = "real";
  auth.state.user = null;
  auth.state.openLogin.mockClear();
});

describe("CommentLikeButton", () => {
  it("opens login for anonymous users without dispatching a write", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CommentLikeButton comment={comment} onConfirmed={vi.fn()} trackId="101" />);
    fireEvent.click(screen.getByRole("button", { name: "赞 Synthetic Author 的评论" }));
    expect(auth.state.openLogin).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits for confirmation, then refreshes without inventing a new count", async () => {
    auth.state.user = { id: "701", nickname: "Synthetic Listener" };
    let release: (response: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const onConfirmed = vi.fn();
    const { rerender } = render(<CommentLikeButton comment={comment} onConfirmed={onConfirmed} trackId="101" />);
    fireEvent.click(screen.getByRole("button", { name: "赞 Synthetic Author 的评论" }));
    expect(screen.getByRole("button", { name: "赞 Synthetic Author 的评论" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "赞 Synthetic Author 的评论" })).toHaveAttribute("aria-pressed", "false");
    expect(onConfirmed).not.toHaveBeenCalled();
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("/api/tracks/101/comments/801/like");
    expect(calls[0][1]).toMatchObject({ method: "PUT" });
    release(Response.json({ ok: true, data: { accepted: true } }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "赞 Synthetic Author 的评论" })).toBeDisabled();
    rerender(<CommentLikeButton comment={{ ...comment, likedByCurrentUser: true, likedCount: 5 }} onConfirmed={onConfirmed} trackId="101" />);
    const unlike = await screen.findByRole("button", { name: "取消赞 Synthetic Author 的评论" });
    await waitFor(() => expect(unlike).toBeEnabled());
    fireEvent.click(unlike);
    expect(calls[1][1]).toMatchObject({ method: "DELETE" });
    release(Response.json({ ok: true, data: { accepted: true } }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(2));
  });

  it("keeps a 429 error inline and blocks an ambiguous result", async () => {
    auth.state.user = { id: "701", nickname: "Synthetic Listener" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: false, error: { code: "RATE_LIMITED", message: "请稍后重试。" } }, { status: 429 }))
      .mockRejectedValueOnce(new Error("lost response"));
    vi.stubGlobal("fetch", fetchMock);
    const onConfirmed = vi.fn();
    render(<CommentLikeButton comment={comment} onConfirmed={onConfirmed} trackId="101" />);
    fireEvent.click(screen.getByRole("button", { name: "赞 Synthetic Author 的评论" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请稍后重试");
    fireEvent.click(screen.getByRole("button", { name: "赞 Synthetic Author 的评论" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("结果尚未确认");
    expect(screen.getByRole("button", { name: "赞 Synthetic Author 的评论" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "刷新评论列表" }));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
