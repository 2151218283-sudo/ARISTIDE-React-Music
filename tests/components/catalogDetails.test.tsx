// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === "string" ? href : ""} {...props}>{children}</a>
  ),
}));

import { CatalogDetailPage } from "../../src/features/catalog/CatalogDetailPage";
import { PlayerProvider } from "../../src/features/player/PlayerProvider";
import type { AlbumDetail, ArtistDetail, PlaybackSource, Track } from "../../src/lib/music/models";

const track: Track = {
  id: "101",
  name: "Synthetic Signal",
  artists: [{ id: "201", name: "Synthetic Artist", avatarUrl: null }],
  album: { id: "301", name: "Synthetic Album", artworkUrl: null },
  durationMs: 180_000,
  artworkUrl: null,
  aliases: [],
  explicit: false,
  availability: "unknown",
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

const albumDetail: AlbumDetail = {
  album: {
    id: "301",
    name: "Synthetic Album",
    artworkUrl: null,
    artists: [{ id: "201", name: "Synthetic Artist", avatarUrl: null }],
    description: "Synthetic album description.",
    publishedAt: 1_700_000_000_000,
    trackCount: 1,
  },
  tracks: [track],
};

function artistDetail(offset = 0, more = false): ArtistDetail {
  return {
    artist: {
      id: "201",
      name: "Synthetic Artist",
      avatarUrl: null,
      aliases: ["Synthetic Alias"],
      biography: "Synthetic artist biography.",
      albumCount: 2,
      trackCount: 1,
    },
    hotTracks: [track],
    albums: {
      items: [{
        id: offset === 0 ? "301" : "302",
        name: offset === 0 ? "Synthetic Album" : "Second Synthetic Album",
        artworkUrl: null,
      }],
      total: 2,
      limit: 20,
      offset,
      hasMore: more,
    },
  };
}

function response(data: AlbumDetail | ArtistDetail): Response {
  return Response.json({ ok: true, data });
}

function renderCatalog(
  element: React.ReactElement,
  fetchMock: (input: RequestInfo | URL) => Promise<Response>,
) {
  vi.stubGlobal("fetch", vi.fn(fetchMock));
  return render(
    <PlayerProvider sourceResolver={async () => source}>
      {element}
    </PlayerProvider>,
  );
}

beforeEach(() => {
  navigation.push.mockReset();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});

afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CatalogDetailPage", () => {
  it("renders a normalized album, keeps all actions local, and starts a finite queue", async () => {
    const user = userEvent.setup();
    renderCatalog(
      <CatalogDetailPage entityId="301" kind="album" />,
      async () => response(albumDetail),
    );

    expect(await screen.findByRole("heading", { name: "Synthetic Album" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Synthetic Artist" }))
      .toHaveAttribute("href", "/artist/201");
    expect(screen.getByRole("link", { name: "查看 Synthetic Signal 的完整播放页" }))
      .toHaveAttribute("href", "/track/101");
    await user.click(screen.getByRole("button", { name: "播放全部" }));
    expect(await screen.findByRole("button", { name: "暂停 Synthetic Signal" })).toBeVisible();
  });

  it("renders a recoverable local not-found state without inventing detail data", async () => {
    renderCatalog(
      <CatalogDetailPage entityId="999" kind="album" />,
      async () => Response.json({
        ok: false,
        error: {
          code: "TRACK_UNAVAILABLE",
          message: "Synthetic missing album.",
          retryable: false,
          requestId: "catalog-component-test",
        },
      }, { status: 404 }),
    );

    expect(await screen.findByRole("heading", { name: "未找到音乐条目" })).toBeVisible();
    expect(screen.getByText("这个链接指向的公开音乐条目已不存在，或暂时不可读取。"))
      .toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "返回搜索" }));
    expect(navigation.push).toHaveBeenCalledWith("/search");
  });

  it("preserves loaded artist albums while appending one distinct next page", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const offset = new URL(String(input), "http://localhost").searchParams.get("offset");
      return response(offset === "0" ? artistDetail(0, true) : artistDetail(1, false));
    });
    renderCatalog(<CatalogDetailPage entityId="201" kind="artist" />, fetchMock);

    expect(await screen.findByRole("heading", { name: "Synthetic Artist" })).toBeVisible();
    expect(screen.getByRole("link", { name: "查看专辑 Synthetic Album" }))
      .toHaveAttribute("href", "/album/301");
    await userEvent.setup().click(screen.getByRole("button", { name: "加载更多专辑" }));
    expect(await screen.findByRole("link", { name: "查看专辑 Second Synthetic Album" }))
      .toBeVisible();
    expect(screen.getByRole("link", { name: "查看专辑 Synthetic Album" })).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(new URL(String(fetchMock.mock.calls[1][0]), "http://localhost").searchParams.get("offset"))
      .toBe("1");
  });

  it("keeps a valid album header when its track collection is empty", async () => {
    renderCatalog(
      <CatalogDetailPage entityId="301" kind="album" />,
      async () => response({ ...albumDetail, tracks: [] }),
    );

    expect(await screen.findByRole("heading", { name: "Synthetic Album" })).toBeVisible();
    expect(screen.getByText("这个专辑暂时没有可列出的曲目。"))
      .toBeVisible();
  });
});
