// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === "string" ? href : ""} {...props}>{children}</a>
  ),
}));

import { SearchDiscoveryLanding } from "../../src/features/search/SearchDiscoveryLanding";
import { PlayerProvider } from "../../src/features/player/PlayerProvider";
import type { PlaybackSource, Track } from "../../src/lib/music/models";

const track: Track = {
  id: "101",
  name: "Discovery Signal",
  artists: [{ id: "201", name: "Discovery Artist", avatarUrl: null }],
  album: { id: "301", name: "Discovery Album", artworkUrl: null },
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

function playlistData() {
  return {
    items: [{
      id: "801",
      name: "Discovery Playlist",
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
  };
}

function renderLanding(fetchMock: (input: RequestInfo | URL) => Promise<Response>) {
  const onFocusInput = vi.fn();
  vi.stubGlobal("fetch", vi.fn(fetchMock));
  render(
    <PlayerProvider sourceResolver={async () => source}>
      <SearchDiscoveryLanding onFocusInput={onFocusInput} />
    </PlayerProvider>,
  );
  return { onFocusInput };
}

beforeEach(() => {
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

describe("SearchDiscoveryLanding", () => {
  it("renders truthfully empty discovery data and offers search recovery", async () => {
    const { onFocusInput } = renderLanding(async (input) => {
      const path = new URL(String(input), "http://localhost").pathname;
      return Response.json({
        ok: true,
        data: path.endsWith("new-songs")
          ? []
          : { ...playlistData(), items: [], total: 0 },
      });
    });

    expect(await screen.findByRole("heading", { name: "暂时没有公开精选" })).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "开始搜索" }));
    expect(onFocusInput).toHaveBeenCalledOnce();
  });

  it("keeps a successful playlist section when new-song discovery fails and retries only that section", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path.endsWith("new-songs")) {
        return Response.json({
          ok: false,
          error: {
            code: "UPSTREAM_UNAVAILABLE",
            message: "Synthetic new-song failure.",
            retryable: true,
            requestId: "discovery-component-test",
          },
        }, { status: 502 });
      }
      return Response.json({ ok: true, data: playlistData() });
    });
    renderLanding(fetchMock);

    expect(await screen.findByRole("link", { name: "查看歌单 Discovery Playlist" }))
      .toHaveAttribute("href", "/playlist/801");
    expect(screen.getByRole("alert")).toHaveTextContent("Synthetic new-song failure.");
    await userEvent.setup().click(screen.getByRole("button", { name: "重试新歌" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(new URL(String(fetchMock.mock.calls[2][0]), "http://localhost").pathname)
      .toBe("/api/discovery/new-songs");
  });

  it("plays a new song in place with a bounded local queue", async () => {
    renderLanding(async (input) => {
      const path = new URL(String(input), "http://localhost").pathname;
      return Response.json({ ok: true, data: path.endsWith("new-songs") ? [track] : playlistData() });
    });

    expect(await screen.findByText("Discovery Signal")).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "播放并检查 Discovery Signal" }));
    expect(await screen.findByRole("button", { name: "暂停 Discovery Signal" })).toBeVisible();
  });
});
