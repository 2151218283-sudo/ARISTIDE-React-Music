// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilmstripGallery } from "../../src/components/FilmstripGallery";
import { AuthProvider } from "../../src/features/auth/AuthProvider";
import {
  DailyRecommendationsProvider,
  useDailyRecommendationsState,
} from "../../src/features/discovery/DailyRecommendationsProvider";
import type { Track } from "../../src/lib/music/models";

const sceneControl = vi.hoisted(() => ({
  shouldThrow: false,
}));

vi.mock("../../src/lib/webgl/filmstripScene", () => ({
  FilmstripScene: class FilmstripScene {
    constructor() {
      if (sceneControl.shouldThrow) {
        throw new Error("WebGL is unavailable");
      }
    }

    destroy() {}
    setInteractive() {}
    setOnCurrentTrackChange() {}
    setOnSelect() {}
  },
}));

const tracks: Track[] = [
  {
    id: "track-001",
    name: "First Signal",
    artists: [{ id: "artist-001", name: "Echo Form", avatarUrl: null }],
    album: { id: "album-001", name: "First Record", artworkUrl: null },
    durationMs: 180_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability: "playable",
    privilege: { fee: 0, maxQuality: null },
  },
  {
    id: "track-002",
    name: "Middle Signal",
    artists: [{ id: "artist-002", name: "Signal Bloom", avatarUrl: null }],
    album: { id: "album-002", name: "Middle Record", artworkUrl: null },
    durationMs: 190_000,
    artworkUrl: "https://example.test/missing-artwork.png",
    aliases: [],
    explicit: false,
    availability: "playable",
    privilege: { fee: 0, maxQuality: null },
  },
  {
    id: "track-003",
    name: "Last Signal",
    artists: [{ id: "artist-003", name: "Quiet Form", avatarUrl: null }],
    album: { id: "album-003", name: "Last Record", artworkUrl: null },
    durationMs: 200_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability: "playable",
    privilege: { fee: 0, maxQuality: null },
  },
];

function apiSuccess(data: unknown): Response {
  return Response.json({ ok: true, data });
}

function DailyRequestProbe() {
  const recommendations = useDailyRecommendationsState();
  return <span data-testid="daily-state">{recommendations.status}</span>;
}

function renderDailyProvider() {
  return render(
    <AuthProvider>
      <DailyRecommendationsProvider>
        <DailyRequestProbe />
        <DailyRequestProbe />
      </DailyRecommendationsProvider>
    </AuthProvider>,
  );
}

function renderGallery(
  selectedTrackId = tracks[0].id,
  onSelect = vi.fn(),
) {
  return render(
    <FilmstripGallery
      isInteractive
      isLoading={false}
      onCurrentTrackChange={vi.fn()}
      onSelect={onSelect}
      selectedTrackId={selectedTrackId}
      tracks={tracks}
    />,
  );
}

afterEach(() => {
  cleanup();
  sceneControl.shouldThrow = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Track gallery", () => {
  it("shares one daily request across homepage consumers", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/session") {
        return Promise.resolve(apiSuccess({ mode: "real", user: null }));
      }
      if (String(input) === "/api/recommendations/daily") {
        return Promise.resolve(apiSuccess({
          date: "2026-07-31",
          source: "public",
          tracks,
        }));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderDailyProvider();

    await waitFor(() => {
      expect(screen.getAllByTestId("daily-state")).toHaveLength(2);
      expect(screen.getAllByTestId("daily-state")[0]).toHaveTextContent("ready");
    });
    expect(fetchMock.mock.calls.filter(([input]) => (
      String(input) === "/api/recommendations/daily"
    ))).toHaveLength(1);
  });

  it("keeps a labelled, keyboard-operable fallback when WebGL initialization fails", async () => {
    sceneControl.shouldThrow = true;
    const onSelect = vi.fn();

    renderGallery(undefined, onSelect);

    const gallery = await screen.findByRole("region", { name: "Daily track gallery" });
    expect(gallery).toHaveAttribute("data-renderer", "fallback");
    expect(gallery).toHaveAttribute("data-artwork-fallback", "true");
    expect(screen.getByRole("button", { name: "上一首推荐歌曲" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一首推荐歌曲" })).toBeEnabled();

    const fallback = screen.getByLabelText("可操作的歌曲画廊降级列表");
    fireEvent.keyDown(fallback, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith(tracks[1]);
    fireEvent.keyDown(fallback, { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith(tracks[2]);
  });

  it("reserves gallery space for the loading and empty states", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <FilmstripGallery
        isInteractive
        isLoading
        onCurrentTrackChange={vi.fn()}
        onSelect={onSelect}
        selectedTrackId={null}
        tracks={[]}
      />,
    );

    expect(screen.getByRole("status", { name: "正在加载歌曲画廊" })).toBeVisible();
    rerender(
      <FilmstripGallery
        isInteractive
        isLoading={false}
        onCurrentTrackChange={vi.fn()}
        onSelect={onSelect}
        selectedTrackId={null}
        tracks={[]}
      />,
    );
    expect(screen.getByText("当前没有可展示的歌曲。")).toBeVisible();
  });
});
