// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  liked: vi.fn(),
  history: vi.fn(),
}));

vi.mock("../../src/features/auth/AuthProvider", () => ({
  useAuth: () => ({ mode: "real", status: "ready", user: { id: "9001" } }),
}));
vi.mock("../../src/features/library/libraryClient", () => ({
  requestLikedTracksPage: mocks.liked,
}));
vi.mock("../../src/lib/listeningHistory", () => ({
  listScopedListeningHistory: mocks.history,
  listeningHistoryChangedEvent: "echoform:history-changed",
  listeningHistoryScope: (_mode: string, id: string) => `real:${id}`,
  toTrack: (track: unknown) => track,
}));

import { TasteProfile } from "../../src/features/profile/TasteProfile";
import type { Track } from "../../src/lib/music/models";

function track(id: string, artistId: string): Track {
  return {
    id,
    name: `Synthetic Track ${id}`,
    artists: [{ id: artistId, name: `Artist ${artistId}`, avatarUrl: null }],
    album: { id, name: `Album ${id}`, artworkUrl: null },
    durationMs: 180_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability: "unknown",
    privilege: { fee: 0, maxQuality: "standard" },
  };
}

beforeEach(() => {
  mocks.liked.mockReset();
  mocks.history.mockReset();
  mocks.history.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TasteProfile", () => {
  it("shows categories derived from the current user's complete liked sample", async () => {
    mocks.liked.mockResolvedValue({
      items: [track("101", "a"), track("102", "a"), track("103", "b"), track("104", "c"), track("105", "c")],
      hasMore: false,
    });
    render(<TasteProfile userId="9001" />);

    expect(await screen.findByText("Artist a")).toBeVisible();
    expect(screen.getByText("Artist b")).toBeVisible();
    expect(screen.getByText("Artist c")).toBeVisible();
    expect(screen.getByText(/当前喜欢歌曲 5 首/)).toBeVisible();
    expect(screen.getAllByText("2 / 5 首 · 40%")).toHaveLength(2);
    expect(mocks.history).toHaveBeenCalledWith("real:9001");
  });

  it("uses a truthful empty state when the identifiable sample is too small", async () => {
    mocks.liked.mockResolvedValue({ items: [track("101", "a")], hasMore: false });
    render(<TasteProfile userId="9001" />);

    expect(await screen.findByText("样本不足，暂不生成画像")).toBeVisible();
    expect(screen.queryByText("Artist a")).toBeNull();
  });

  it("does not use a partial liked sample and retries after a read failure", async () => {
    mocks.liked.mockRejectedValueOnce(new Error("Synthetic read failure"));
    mocks.liked.mockResolvedValue({ items: [track("101", "a")], hasMore: false });
    render(<TasteProfile userId="9001" />);

    expect(await screen.findByText("无法计算音乐品味样本")).toBeVisible();
    expect(screen.queryByText("Artist a")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(mocks.liked).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("样本不足，暂不生成画像")).toBeVisible();
  });
});
