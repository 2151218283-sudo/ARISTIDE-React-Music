// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => {
  return {
    search: "",
  };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === "string" ? href : ""} {...props}>{children}</a>
  ),
}));

import { SearchExperience } from "../../src/features/search/SearchExperience";
import { PlayerProvider } from "../../src/features/player/PlayerProvider";
import type { PlaybackSource, SearchResponse, Track } from "../../src/lib/music/models";

const track: Track = {
  id: "track-001",
  name: "First Signal",
  artists: [{ id: "artist-001", name: "Echo Form", avatarUrl: null }],
  album: { id: "album-001", name: "Reference Record", artworkUrl: null },
  durationMs: 183_000,
  artworkUrl: null,
  aliases: [],
  explicit: false,
  availability: "playable",
  privilege: { fee: 0, maxQuality: "standard" },
};

const source: PlaybackSource = {
  url: "synthetic-stream",
  expiresAt: Number.MAX_SAFE_INTEGER,
  quality: "standard",
  codec: "mp3",
  bitrate: 128_000,
  sampleRate: 44_100,
  sizeBytes: 4_096,
  corsMode: "unavailable",
};

function allResult(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    type: "all",
    tracks: { items: [track], total: 1, hasMore: false },
    artists: {
      items: [{ id: "artist-001", name: "Echo Form", avatarUrl: null }],
      total: 1,
      hasMore: false,
    },
    albums: {
      items: [{ id: "album-001", name: "Reference Record", artworkUrl: null }],
      total: 1,
      hasMore: false,
    },
    partialErrors: [],
    ...overrides,
  } as SearchResponse;
}

function success(data: SearchResponse): Response {
  return Response.json({ ok: true, data });
}

function failure(message: string): Response {
  return Response.json({
    ok: false,
    error: {
      code: "UPSTREAM_UNAVAILABLE",
      message,
      retryable: true,
      requestId: "search-component-test",
    },
  }, { status: 502 });
}

function renderSearch(fetchMock: (input: RequestInfo | URL) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/discovery/new-songs") {
      return Response.json({ ok: true, data: [track] });
    }
    if (url.pathname === "/api/discovery/popular-playlists") {
      return Response.json({
        ok: true,
        data: {
          items: [{
            id: "playlist-001",
            name: "Discovery Signal",
            description: null,
            artworkUrl: null,
            owner: null,
            visibility: "public",
            trackCount: 1,
            createdAt: null,
            updatedAt: null,
          }],
          total: 1,
          limit: 8,
          offset: 0,
          hasMore: false,
        },
      });
    }
    return fetchMock(input);
  }));
  return render(
    <PlayerProvider sourceResolver={async () => source}>
      <SearchExperience />
    </PlayerProvider>,
  );
}

async function searchFor(user: ReturnType<typeof userEvent.setup>, query: string): Promise<void> {
  const input = screen.getByLabelText("搜索歌曲、歌手或专辑");
  await user.clear(input);
  await user.type(input, query);
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});

afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  navigation.search = "";
  window.history.replaceState(null, "", "/");
  window.sessionStorage.removeItem("echoform:page-heading-focus");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SearchExperience", () => {
  it("renders independent discovery sections for an empty query and focuses the visible input with slash", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => success(allResult()));
    renderSearch(fetchMock);

    expect(screen.getByText("输入歌曲、歌手或专辑关键词，开始查找音乐。")).toBeVisible();
    expect(await screen.findByRole("heading", { name: "新歌" })).toBeVisible();
    expect(screen.getByRole("link", { name: "查看歌单 Discovery Signal" }))
      .toHaveAttribute("href", "/playlist/playlist-001");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    await user.keyboard("/");
    expect(screen.getByLabelText("搜索歌曲、歌手或专辑")).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("moves focus to the page heading after a same-origin search navigation", () => {
    window.history.replaceState(null, "", "/search");
    window.sessionStorage.setItem("echoform:page-heading-focus", "/search");
    renderSearch(async () => success(allResult()));

    expect(screen.getByRole("heading", { name: "搜索" })).toHaveFocus();
    expect(window.sessionStorage.getItem("echoform:page-heading-focus")).toBeNull();
  });

  it("renders normalized all-search sections, preserves a partial failure, and plays without leaving search", async () => {
    const user = userEvent.setup();
    const response = allResult({
      artists: { items: [], total: null, hasMore: false },
      partialErrors: [{ type: "artist", code: "UPSTREAM_UNAVAILABLE", retryable: true }],
    });
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => success(response));
    renderSearch(fetchMock);

    await searchFor(user, "A&B");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText("First Signal")).toBeVisible());

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");
    expect(requestUrl.searchParams.get("q")).toBe("A&B");
    expect(requestUrl.searchParams.get("type")).toBe("all");
    expect(requestUrl.searchParams.get("limit")).toBe("20");
    expect(requestUrl.searchParams.get("offset")).toBe("0");
    expect(screen.getByRole("alert")).toHaveTextContent("歌手结果暂时不可用");
    expect(screen.getByRole("link", { name: "查看专辑 Reference Record" }))
      .toHaveAttribute("href", "/album/album-001");
    expect(screen.getByRole("link", { name: "查看 First Signal 的完整播放页" }))
      .toHaveAttribute("href", "/track/track-001");

    await user.click(screen.getByRole("button", { name: "播放 First Signal" }));
    expect(await screen.findByRole("button", { name: "暂停 First Signal" })).toBeVisible();
    expect(window.location.search).toBe("?q=A%26B&type=all");
  });

  it("checks unknown tracks only after the playable filter is enabled", async () => {
    const user = userEvent.setup();
    const unknownTrack = { ...track, availability: "unknown" as const };
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/availability")) {
        return Response.json({
          ok: true,
          data: { state: "verified-playable" },
        });
      }
      return success(allResult({
        tracks: { items: [unknownTrack], total: 1, hasMore: false },
      }));
    });
    renderSearch(fetchMock);

    await searchFor(user, "signal");
    await waitFor(() => expect(screen.getByText("First Signal")).toBeVisible());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "播放并检查 First Signal" })).toBeEnabled();

    await user.click(screen.getByRole("checkbox", { name: "仅看可播放" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(new URL(String(fetchMock.mock.calls[1][0]), "http://localhost").pathname)
      .toBe("/api/tracks/track-001/availability");
    expect(window.location.search).toBe("?q=signal&type=all&playable=1");
    await waitFor(() => expect(screen.queryByText("正在检查 1 首歌曲是否可播放"))
      .not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "播放 First Signal" })).toBeEnabled();
  });

  it("ignores a stale response after rapid input", async () => {
    const user = userEvent.setup();
    let resolveFirst: ((response: Response) => void) | undefined;
    const freshTrack = { ...track, id: "track-002", name: "Fresh Signal" };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const query = new URL(String(input), "http://localhost").searchParams.get("q");
      if (query === "old") {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      if (query === "fresh") {
        return Promise.resolve(success(allResult({
          tracks: { items: [freshTrack], total: 1, hasMore: false },
        })));
      }
      return Promise.resolve(failure("搜索服务暂时不可用。"));
    });
    renderSearch(fetchMock);

    await searchFor(user, "old");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await searchFor(user, "fresh");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Fresh Signal")).toBeVisible());
    resolveFirst?.(success(allResult()));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("First Signal")).not.toBeInTheDocument();

  });

  it("retains the previous valid result when a replacement request fails", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const query = new URL(String(input), "http://localhost").searchParams.get("q");
      return Promise.resolve(query === "failure"
        ? failure("搜索服务暂时不可用。")
        : success(allResult()));
    });
    renderSearch(fetchMock);

    await searchFor(user, "stable");
    await waitFor(() => expect(screen.getByText("First Signal")).toBeVisible());
    await searchFor(user, "failure");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("无法更新搜索结果"));
    expect(screen.getByText("First Signal")).toBeVisible();
    expect(screen.getByRole("button", { name: "重试" })).toBeEnabled();
  });

  it("pages a single-type search without clearing loaded tracks and restores route query/type", async () => {
    navigation.search = "q=signals&type=track";
    const secondTrack = { ...track, id: "track-003", name: "Second Signal" };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const offset = new URL(String(input), "http://localhost").searchParams.get("offset");
      return Promise.resolve(success(offset === "0" ? {
        type: "track",
        items: [track],
        total: 2,
        limit: 20,
        offset: 0,
        hasMore: true,
      } : {
        type: "track",
        items: [secondTrack],
        total: 2,
        limit: 20,
        offset: 1,
        hasMore: false,
      }));
    });
    renderSearch(fetchMock);

    await waitFor(() => expect(screen.getByText("First Signal")).toBeVisible());
    expect(screen.getByLabelText("搜索歌曲、歌手或专辑")).toHaveValue("signals");
    expect(screen.getByRole("tab", { name: "歌曲" })).toHaveAttribute("aria-selected", "true");
    await userEvent.setup().click(screen.getByRole("button", { name: "加载更多" }));
    await waitFor(() => expect(screen.getByText("Second Signal")).toBeVisible());
    expect(screen.getByText("First Signal")).toBeVisible();
    expect(new URL(String(fetchMock.mock.calls[1][0]), "http://localhost").searchParams.get("offset"))
      .toBe("1");
  });

  it("adds a local history entry when the search type changes", async () => {
    navigation.search = "q=signals&type=track";
    const pushState = vi.spyOn(window.history, "pushState");
    renderSearch(async () => success(allResult()));

    await waitFor(() => expect(screen.getByText("First Signal")).toBeVisible());
    await userEvent.setup().click(screen.getByRole("tab", { name: "综合" }));

    expect(pushState).toHaveBeenCalledWith(null, "", "/search?q=signals&type=all");
    expect(window.location.search).toBe("?q=signals&type=all");
  });
});
