// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const auth = vi.hoisted(() => ({
  openLogin: vi.fn(),
  status: "ready" as "loading" | "ready",
  user: null as { id: string; nickname: string; avatarUrl: string | null; signature: string | null } | null,
}));
const history = vi.hoisted(() => ({ clear: vi.fn(), list: vi.fn() }));
const profile = vi.hoisted(() => ({ playlists: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === "string" ? href : ""} {...props}>{children}</a>
  ),
}));
vi.mock("../../src/features/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("../../src/features/profile/profileClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/features/profile/profileClient")>(),
  requestUserPlaylists: profile.playlists,
}));
vi.mock("../../src/lib/listeningHistory", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/lib/listeningHistory")>(),
  clearListeningHistory: history.clear,
  listListeningHistory: history.list,
}));

import { LibraryExperience } from "../../src/features/library/LibraryExperience";
import { PlayerProvider } from "../../src/features/player/PlayerProvider";
import type { ListeningHistoryEntry } from "../../src/lib/listeningHistory";
import type { PlaybackSource, Track, UserPlaylistCollection } from "../../src/lib/music/models";

const source: PlaybackSource = {
  bitrate: null,
  codec: null,
  corsMode: "unavailable",
  expiresAt: Number.MAX_SAFE_INTEGER,
  quality: "standard",
  sampleRate: null,
  sizeBytes: null,
  url: "synthetic-source",
};

function track(id: string): Track {
  return {
    album: { artworkUrl: null, id: `album-${id}`, name: `Album ${id}` },
    aliases: [],
    artists: [{ avatarUrl: null, id: `artist-${id}`, name: `Artist ${id}` }],
    artworkUrl: null,
    availability: "playable",
    durationMs: 120_000,
    explicit: false,
    id,
    name: `Track ${id}`,
    privilege: { fee: null, maxQuality: "standard" },
  };
}

function historyEntry(id: string, playedAt = Number(id) || 1): ListeningHistoryEntry {
  const value = track(id);
  return {
    completed: false,
    playedAt,
    playedMs: 30_000,
    source: "local",
    track: {
      album: value.album,
      aliases: value.aliases,
      artists: value.artists.map(({ id: artistId, name }) => ({ id: artistId, name })),
      artworkUrl: value.artworkUrl,
      availability: value.availability,
      durationMs: value.durationMs,
      explicit: value.explicit,
      id: value.id,
      name: value.name,
      privilege: value.privilege,
    },
    trackId: id,
  };
}

const collection: UserPlaylistCollection = {
  created: [{
    artworkUrl: null,
    createdAt: null,
    description: null,
    id: "created-1",
    name: "Created signals",
    owner: null,
    trackCount: 3,
    updatedAt: null,
    visibility: "public",
  }],
  liked: {
    artworkUrl: null,
    createdAt: null,
    description: null,
    id: "liked-1",
    name: "Liked signals",
    owner: null,
    trackCount: 5,
    updatedAt: null,
    visibility: "public",
  },
  subscribed: [],
};

function renderLibrary() {
  return render(
    <PlayerProvider sourceResolver={async () => source}>
      <LibraryExperience />
    </PlayerProvider>,
  );
}

beforeEach(() => {
  auth.openLogin.mockReset();
  auth.status = "ready";
  auth.user = null;
  history.list.mockReset();
  history.list.mockResolvedValue([]);
  history.clear.mockReset();
  history.clear.mockResolvedValue(undefined);
  profile.playlists.mockReset();
  profile.playlists.mockResolvedValue(collection);
  navigation.push.mockReset();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LibraryExperience", () => {
  it("keeps anonymous account tabs local and opens the existing QR login flow", async () => {
    renderLibrary();

    expect(await screen.findByRole("heading", { name: "登录后查看你的音乐库" })).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "扫码登录" }));
    expect(auth.openLogin).toHaveBeenCalledOnce();
    expect(profile.playlists).not.toHaveBeenCalled();
  });

  it("reads the verified playlist collection and states unavailable album data truthfully", async () => {
    auth.user = { avatarUrl: null, id: "user-1", nickname: "Listener", signature: null };
    renderLibrary();

    expect(await screen.findByRole("link", { name: "查看歌单 Liked signals" }))
      .toHaveAttribute("href", "/playlist/liked-1");
    await userEvent.setup().click(screen.getByRole("tab", { name: "歌单" }));
    expect(await screen.findByRole("link", { name: "查看歌单 Created signals" }))
      .toHaveAttribute("href", "/playlist/created-1");
    await userEvent.setup().click(screen.getByRole("tab", { name: "专辑" }));
    expect(await screen.findByRole("heading", { name: "收藏专辑暂不可读取" })).toBeVisible();
  });

  it("reads local history offline, preserves the first segment, and reveals more rows", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    history.list.mockResolvedValue(Array.from({ length: 51 }, (_, index) => (
      historyEntry(String(index + 1), 1_000 - index)
    )));
    renderLibrary();

    await userEvent.setup().click(screen.getByRole("tab", { name: "播放记录" }));
    expect(await screen.findByText("本地离线记录")).toBeVisible();
    expect(screen.getByText("Track 1")).toBeVisible();
    expect(screen.queryByText("Track 51")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "显示更多" }));
    expect(screen.getByText("Track 1")).toBeVisible();
    expect(screen.getByText("Track 51")).toBeVisible();
  });

  it("retains no fabricated history after a storage failure and retries the read", async () => {
    history.list
      .mockRejectedValueOnce(new Error("Synthetic storage failure"))
      .mockResolvedValueOnce([historyEntry("retry")]);
    renderLibrary();

    await userEvent.setup().click(screen.getByRole("tab", { name: "播放记录" }));
    expect(await screen.findByRole("heading", { name: "无法读取本地播放记录" })).toBeVisible();
    expect(screen.queryByText("Track retry")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByText("Track retry")).toBeVisible());
    expect(history.list).toHaveBeenCalledTimes(2);
  });

  it("keeps local history unchanged when clearing is cancelled or escaped", async () => {
    history.list.mockResolvedValue([historyEntry("local")]);
    renderLibrary();

    await userEvent.setup().click(screen.getByRole("tab", { name: "播放记录" }));
    const clearTrigger = await screen.findByRole("button", { name: "清空记录" });
    await userEvent.setup().click(clearTrigger);
    await screen.findByRole("dialog", { name: "清空播放记录？" });
    const cancel = screen.getByRole("button", { name: "取消" });
    expect(cancel).toHaveFocus();
    await userEvent.setup().click(cancel);
    expect(history.clear).not.toHaveBeenCalled();
    expect(screen.getByText("Track local")).toBeVisible();
    expect(clearTrigger).toHaveFocus();

    await userEvent.setup().click(clearTrigger);
    await screen.findByRole("dialog", { name: "清空播放记录？" });
    await userEvent.setup().keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "清空播放记录？" })).toBeNull();
    expect(history.clear).not.toHaveBeenCalled();
    expect(screen.getByText("Track local")).toBeVisible();
    expect(clearTrigger).toHaveFocus();
  });

  it("clears the rendered local history only after the adapter confirms success", async () => {
    history.list.mockResolvedValue([historyEntry("confirmed")]);
    renderLibrary();

    await userEvent.setup().click(screen.getByRole("tab", { name: "播放记录" }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "清空记录" }));
    const dialog = await screen.findByRole("dialog", { name: "清空播放记录？" });
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "清空记录" }));

    await waitFor(() => expect(history.clear).toHaveBeenCalledOnce());
    expect(screen.queryByText("Track confirmed")).toBeNull();
    expect(screen.getByRole("heading", { name: "还没有本地播放记录" })).toBeVisible();
    expect(screen.getByText("播放记录已清空。")).toBeVisible();
  });

  it("prevents duplicate clear submits while the local transaction is pending", async () => {
    let resolveClear!: () => void;
    history.list.mockResolvedValue([historyEntry("pending-clear")]);
    history.clear.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveClear = resolve;
    }));
    renderLibrary();

    await userEvent.setup().click(screen.getByRole("tab", { name: "播放记录" }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "清空记录" }));
    const dialog = await screen.findByRole("dialog", { name: "清空播放记录？" });
    const confirm = within(dialog).getByRole("button", { name: "清空记录" });
    await userEvent.setup().click(confirm);
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
    await waitFor(() => expect(dialog).toHaveFocus());
    await userEvent.setup().click(confirm);
    expect(history.clear).toHaveBeenCalledOnce();

    resolveClear();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "清空播放记录？" })).toBeNull());
    expect(screen.getByRole("heading", { name: "还没有本地播放记录" })).toBeVisible();
  });

  it("retains rows and exposes a deliberate retry after a clear failure", async () => {
    history.list.mockResolvedValue([historyEntry("retry-clear")]);
    history.clear.mockRejectedValueOnce(new Error("Synthetic clear failure"));
    renderLibrary();

    await userEvent.setup().click(screen.getByRole("tab", { name: "播放记录" }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "清空记录" }));
    const dialog = await screen.findByRole("dialog", { name: "清空播放记录？" });
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "清空记录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法清空本地播放记录。");
    expect(screen.getByText("Track retry-clear")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "清空播放记录？" })).toBeVisible();
    expect(history.clear).toHaveBeenCalledOnce();
  });
});
