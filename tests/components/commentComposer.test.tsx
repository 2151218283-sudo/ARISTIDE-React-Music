// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommentComposer } from "../../src/features/player/CommentComposer";

const auth = vi.hoisted(() => ({
  state: {
    mode: "real" as "real" | "demo",
    status: "ready" as "ready" | "loading",
    user: null as { id: string; nickname: string } | null,
    openLogin: vi.fn(),
  },
}));

vi.mock("../../src/features/auth/AuthProvider", () => ({ useAuth: () => auth.state }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  auth.state.user = null;
  auth.state.mode = "real";
  auth.state.openLogin.mockClear();
});

function setup() {
  const onConfirmed = vi.fn();
  const onRefresh = vi.fn();
  render(<CommentComposer trackId="101" onConfirmed={onConfirmed} onRefresh={onRefresh} />);
  return { onConfirmed, onRefresh };
}

describe("CommentComposer", () => {
  it("offers login to anonymous users and keeps demo mode read-only", () => {
    const { rerender } = render(<CommentComposer trackId="101" onConfirmed={vi.fn()} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "扫码登录后发表评论" }));
    expect(auth.state.openLogin).toHaveBeenCalledTimes(1);
    auth.state.mode = "demo";
    rerender(<CommentComposer trackId="101" onConfirmed={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText("演示模式不支持发表评论")).toBeVisible();
  });

  it("validates, shows sending, and refreshes only after confirmation", async () => {
    auth.state.user = { id: "701", nickname: "Synthetic Listener" };
    let release: (response: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const { onConfirmed } = setup();
    fireEvent.click(screen.getByRole("button", { name: "发表" }));
    expect(screen.getByRole("alert")).toHaveTextContent("1 至 1000");
    fireEvent.change(screen.getByRole("textbox", { name: "发表评论" }), { target: { value: "Synthetic comment" } });
    fireEvent.click(screen.getByRole("button", { name: "发表" }));
    expect(screen.getByRole("button", { name: "发送中" })).toBeDisabled();
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/tracks/101/comments");
    expect(JSON.parse(String(options.body))).toMatchObject({ content: "Synthetic comment" });
    release(Response.json({ ok: true, data: { accepted: true } }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("textbox", { name: "发表评论" })).toHaveValue("");
  });

  it("keeps a 429 draft for deliberate retry and opens login on 401", async () => {
    auth.state.user = { id: "701", nickname: "Synthetic Listener" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: false, error: { code: "RATE_LIMITED", message: "请稍后重试。" } }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ ok: false, error: { code: "SESSION_EXPIRED", message: "请重新登录。" } }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.change(screen.getByRole("textbox", { name: "发表评论" }), { target: { value: "Synthetic comment" } });
    fireEvent.click(screen.getByRole("button", { name: "发表" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请稍后重试");
    expect(screen.getByRole("textbox", { name: "发表评论" })).toHaveValue("Synthetic comment");
    fireEvent.click(screen.getByRole("button", { name: "发表" }));
    await waitFor(() => expect(auth.state.openLogin).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never resends after a lost response and keeps an inline refresh action", async () => {
    auth.state.user = { id: "701", nickname: "Synthetic Listener" };
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network lost"));
    vi.stubGlobal("fetch", fetchMock);
    const { onRefresh } = setup();
    fireEvent.change(screen.getByRole("textbox", { name: "发表评论" }), { target: { value: "Synthetic comment" } });
    fireEvent.click(screen.getByRole("button", { name: "发表" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("提交结果尚未确认");
    expect(screen.getByRole("button", { name: "发表" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "刷新评论列表" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("focuses the reply draft and sends the exact parent ID", async () => {
    auth.state.user = { id: "701", nickname: "Synthetic Listener" };
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, data: { accepted: true } }));
    vi.stubGlobal("fetch", fetchMock);
    const onConfirmed = vi.fn();
    const onCancelReply = vi.fn();
    render(<CommentComposer
      trackId="101"
      replyTo={{ id: "801", nickname: "Synthetic Author" }}
      onCancelReply={onCancelReply}
      onConfirmed={onConfirmed}
      onRefresh={vi.fn()}
    />);
    const input = screen.getByRole("textbox", { name: "回复 @Synthetic Author" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "Synthetic reply" } });
    fireEvent.click(screen.getByRole("button", { name: "发送回复" }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(onCancelReply).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      content: "Synthetic reply", replyToCommentId: "801",
    });
  });
});
