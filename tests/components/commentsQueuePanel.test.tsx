// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useRef } from "react";

import { CommentsQueuePanel } from "../../src/features/player/CommentsQueuePanel";
import { PlayerProvider } from "../../src/features/player/PlayerProvider";
import { usePlayerDispatch } from "../../src/features/player/playerContext";
import type { PlaybackSource, Track } from "../../src/lib/music/models";
import type { QueueItem } from "../../src/lib/player";

const source: PlaybackSource = {
  url: "memory:comments-queue-panel",
  expiresAt: 9_999_999_999_999,
  quality: "standard",
  codec: "mp3",
  bitrate: 128_000,
  sampleRate: 44_100,
  sizeBytes: null,
  corsMode: "anonymous",
};

function track(id: string, availability: Track["availability"] = "playable"): Track {
  return {
    id,
    name: `Track ${id}`,
    artists: [{ id: `artist-${id}`, name: `Artist ${id}`, avatarUrl: null }],
    album: { id: `album-${id}`, name: `Album ${id}`, artworkUrl: null },
    durationMs: 180_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability,
    privilege: { fee: 0, maxQuality: "standard" },
  };
}

function queueItem(id: string, availability: Track["availability"] = "playable"): QueueItem {
  return {
    queueItemId: `queue-${id}`,
    sourceContext: "manual",
    track: track(id, availability),
  };
}

function success(data: unknown): Response {
  return Response.json({ ok: true, data });
}

function failure(message: string): Response {
  return Response.json({
    ok: false,
    error: {
      code: "UPSTREAM_UNAVAILABLE",
      message,
      requestId: "comments-queue-test",
      retryable: true,
    },
  }, { status: 503 });
}

function QueueSeed({ queue }: { queue: readonly QueueItem[] }) {
  const dispatch = usePlayerDispatch();
  const initialQueue = useRef(queue);

  useEffect(() => {
    dispatch({
      type: "SET_QUEUE",
      queue: initialQueue.current,
      startTrackId: initialQueue.current[0]?.track.id,
    });
  }, [dispatch]);

  return <CommentsQueuePanel trackId="123" />;
}

function renderPanel(
  queue: readonly QueueItem[] = [],
  fetchMock: (input: RequestInfo | URL) => Promise<Response> = async () => success({
    items: [],
    total: 0,
    hasMore: false,
    limit: 10,
    offset: 0,
  }),
) {
  vi.stubGlobal("fetch", vi.fn(fetchMock));
  return render(
    <PlayerProvider sourceResolver={async () => source}>
      <QueueSeed queue={queue} />
    </PlayerProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
});

afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CommentsQueuePanel", () => {
  it("loads comments lazily, paginates, and preserves rows while later pages load", async () => {
    const firstComment = {
      id: "comment-001",
      author: { id: "author-001", nickname: "First Listener", avatarUrl: null, signature: null },
      content: "First comment",
      createdAt: 1_735_689_600_000,
      likedCount: 1,
      likedByCurrentUser: false,
      replyTo: null,
    };
    const secondComment = {
      ...firstComment,
      id: "comment-002",
      content: "Second comment",
      likedCount: 4,
    };
    let resolveFirstPage: (response: Response) => void = () => {
      throw new Error("The deferred comments response was not initialized.");
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const offset = new URL(String(input), "http://localhost").searchParams.get("offset");
      if (offset === "0") {
        return new Promise<Response>((resolve) => {
          resolveFirstPage = resolve;
        });
      }
      return Promise.resolve(success(offset === "0" ? {
        items: [firstComment],
        total: 2,
        hasMore: true,
        limit: 10,
        offset: 0,
      } : {
        items: [secondComment],
        total: 2,
        hasMore: false,
        limit: 10,
        offset: 1,
      }));
    });
    renderPanel([], fetchMock);

    fireEvent.click(screen.getByRole("button", { name: "评论" }));
    expect(await screen.findByLabelText("评论加载中")).toBeVisible();
    resolveFirstPage?.(success({
      items: [firstComment],
      total: 2,
      hasMore: true,
      limit: 10,
      offset: 0,
    }));
    expect(await screen.findByText("First comment")).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/tracks/123/comments?limit=10&offset=0"),
      expect.any(Object),
    );

    fireEvent.change(screen.getByRole("combobox", { name: "评论排序" }), {
      target: { value: "popular" },
    });
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(screen.getByText("First comment")).toBeVisible();
    expect(await screen.findByText("Second comment")).toBeVisible();
    expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
  });

  it("renders comment error, retry, and empty states without fabricating a composer", async () => {
    let attempts = 0;
    renderPanel([], async () => {
      attempts += 1;
      return attempts === 1
        ? failure("评论服务暂时不可用")
        : success({
          items: [],
          total: 0,
          hasMore: false,
          limit: 10,
          offset: 0,
        });
    });

    fireEvent.click(screen.getByRole("button", { name: "评论" }));
    expect(await screen.findByRole("heading", { name: "评论加载失败" })).toBeVisible();
    expect(screen.getByText("评论服务暂时不可用")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("还没有可显示的评论")).toBeVisible();
    expect(screen.getByRole("button", { name: "登录后发表评论" })).toBeDisabled();
  });

  it("preserves existing comments when a later page fails and retries that page", async () => {
    const firstComment = {
      id: "comment-001",
      author: { id: "author-001", nickname: "First Listener", avatarUrl: null, signature: null },
      content: "First comment",
      createdAt: 1_735_689_600_000,
      likedCount: 1,
      likedByCurrentUser: false,
      replyTo: null,
    };
    const secondComment = { ...firstComment, id: "comment-002", content: "Second comment" };
    let laterPageAttempts = 0;
    renderPanel([], async (input) => {
      const offset = new URL(String(input), "http://localhost").searchParams.get("offset");
      if (offset === "0") {
        return success({
          items: [firstComment],
          total: 2,
          hasMore: true,
          limit: 10,
          offset: 0,
        });
      }

      laterPageAttempts += 1;
      return laterPageAttempts === 1
        ? failure("无法加载更多评论")
        : success({
          items: [secondComment],
          total: 2,
          hasMore: false,
          limit: 10,
          offset: 1,
        });
    });

    fireEvent.click(screen.getByRole("button", { name: "评论" }));
    expect(await screen.findByText("First comment")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法加载更多评论");
    expect(screen.getByText("First comment")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("Second comment")).toBeVisible();
  });

  it("keeps one panel open, closes by Escape, and restores focus to its trigger", async () => {
    renderPanel();
    const commentsTrigger = screen.getByRole("button", { name: "评论" });
    fireEvent.click(commentsTrigger);

    const dialog = await screen.findByRole("dialog", { name: "评论" });
    expect(dialog).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭评论" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "队列" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "队列" })).toBeVisible();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "队列" })).toHaveFocus();
  });

  it("traps Tab inside the panel and restores focus after backdrop dismissal", async () => {
    renderPanel([], async () => success({
      items: [{
        id: "comment-001",
        author: { id: "author-001", nickname: "First Listener", avatarUrl: null, signature: null },
        content: "First comment",
        createdAt: 1_735_689_600_000,
        likedCount: 1,
        likedByCurrentUser: false,
        replyTo: null,
      }],
      total: 1,
      hasMore: false,
      limit: 10,
      offset: 0,
    }));
    const commentsTrigger = screen.getByRole("button", { name: "评论" });
    fireEvent.click(commentsTrigger);

    const dialog = await screen.findByRole("dialog", { name: "评论" });
    const closeButton = screen.getByRole("button", { name: "关闭评论" });
    const orderSelect = screen.getByRole("combobox", { name: "评论排序" });
    closeButton.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(orderSelect).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "关闭侧边面板" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(commentsTrigger).toHaveFocus();
  });

  it("shows current and unavailable queue rows, selects a track, removes it, and undoes removal", async () => {
    const queue = [
      queueItem("one"),
      queueItem("two"),
      queueItem("three", "copyright"),
    ];
    renderPanel(queue);
    fireEvent.click(screen.getByRole("button", { name: "队列" }));

    expect(await screen.findByRole("button", { name: "当前歌曲，Track one" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Track three，因版权限制不可播放" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "播放Track two" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "当前歌曲，Track two" }))
      .toHaveAttribute("aria-current", "true"));

    fireEvent.click(screen.getByRole("button", { name: "从队列移除 Track two" }));
    expect(await screen.findByText("已从队列移除《Track two》")).toBeVisible();
    expect(screen.queryByRole("button", { name: "当前歌曲，Track two" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(await screen.findByRole("button", { name: "播放Track two" })).toBeVisible();
  });

  it("enters the safe empty queue state after removing its only item", async () => {
    renderPanel([queueItem("only")]);
    fireEvent.click(screen.getByRole("button", { name: "队列" }));
    await screen.findByRole("button", { name: "当前歌曲，Track only" });

    fireEvent.click(screen.getByRole("button", { name: "从队列移除 Track only" }));
    expect(await screen.findByText("队列中没有下一首")).toBeVisible();
    expect(screen.getByRole("link", { name: "浏览每日推荐" })).toHaveAttribute("href", "/");
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(await screen.findByRole("button", { name: "当前歌曲，Track only" }))
      .toHaveAttribute("aria-current", "true");
  });
});
