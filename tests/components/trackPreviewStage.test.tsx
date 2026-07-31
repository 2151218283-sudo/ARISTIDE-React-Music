// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TrackPreviewStage } from "../../src/features/discovery/TrackPreviewStage";
import { PlayerProvider } from "../../src/features/player/PlayerProvider";
import { usePlayerSelector } from "../../src/features/player/playerContext";
import type { Track } from "../../src/lib/music/models";

const tracks: Track[] = [
  {
    id: "track-001",
    name: "First Signal",
    artists: [{ id: "artist-001", name: "Echo Form", avatarUrl: null }],
    album: { id: "album-001", name: "Daily Record", artworkUrl: null },
    durationMs: 183_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability: "playable",
    privilege: { fee: 0, maxQuality: null },
  },
  {
    id: "track-002",
    name: "Restricted Signal",
    artists: [{ id: "artist-002", name: "Quiet Form", avatarUrl: null }],
    album: { id: "album-002", name: "Locked Record", artworkUrl: null },
    durationMs: 196_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability: "vip",
    privilege: { fee: 1, maxQuality: null },
  },
];

function success(data: unknown): Response {
  return Response.json({ ok: true, data });
}

function failure(message: string, retryable = true): Response {
  return Response.json({
    ok: false,
    error: {
      code: "UPSTREAM_UNAVAILABLE",
      message,
      requestId: "preview-test",
      retryable,
    },
  }, { status: 503 });
}

function PlayerProbe() {
  const currentTrackId = usePlayerSelector((snapshot) => snapshot.currentTrack?.id ?? "none");
  const desiredPlayback = usePlayerSelector((snapshot) => snapshot.desiredPlayback);
  return <output data-testid="player-probe">{currentTrackId}:{desiredPlayback}</output>;
}

function renderPreview({
  onClose = vi.fn(),
  phase = "entering" as const,
  track = tracks[0],
}: {
  onClose?: () => void;
  phase?: "entering" | "visible" | "exiting";
  track?: Track;
} = {}) {
  const sourceResolver = vi.fn(() => new Promise<never>(() => undefined));
  const onExplore = vi.fn();
  const result = render(
    <PlayerProvider sourceResolver={sourceResolver}>
      <PlayerProbe />
      <TrackPreviewStage
        index={tracks.findIndex((candidate) => candidate.id === track.id)}
        onClose={onClose}
        onExplore={onExplore}
        phase={phase}
        showDomArtwork={false}
        total={tracks.length}
        track={track}
        tracks={tracks}
      />
    </PlayerProvider>,
  );
  return { ...result, onClose, onExplore, sourceResolver };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TrackPreviewStage", () => {
  it("keeps first-frame playback active while normalized details and lyrics load", async () => {
    let resolveTrack: ((response: Response) => void) | undefined;
    let resolveLyrics: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/lyrics")) {
        return new Promise<Response>((resolve) => {
          resolveLyrics = resolve;
        });
      }
      return new Promise<Response>((resolve) => {
        resolveTrack = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { onExplore } = renderPreview();

    expect(screen.getByRole("heading", { name: "First Signal" })).toBeVisible();
    expect(screen.getByText("正在补全歌曲信息…")).toBeVisible();
    expect(screen.getByText("正在读取歌词…")).toBeVisible();
    const play = screen.getByRole("button", { name: "播放 First Signal" });
    expect(play).toBeEnabled();
    fireEvent.click(play);
    expect(screen.getByTestId("player-probe")).toHaveTextContent("track-001:playing");

    resolveTrack?.(success({
      ...tracks[0],
      album: { ...tracks[0].album, name: "Resolved Record" },
    }));
    resolveLyrics?.(success({
      kind: "synced",
      lines: [
        { startMs: 0, durationMs: null, text: "First lyric", translation: null, romanization: null, words: null },
        { startMs: 1_000, durationMs: null, text: "Second lyric", translation: null, romanization: null, words: null },
      ],
    }));

    expect(await screen.findByText("Resolved Record")).toBeVisible();
    expect(await screen.findByText("First lyric")).toBeVisible();
    const explore = screen.getByRole("link", { name: /First Signal/ });
    explore.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(explore);
    expect(onExplore).toHaveBeenCalledWith(expect.objectContaining({ id: "track-001" }));
    expect(screen.getByRole("link", { name: "打开 First Signal 的完整播放页" }))
      .toHaveAttribute("href", "/track/track-001");
    expect(screen.getByRole("button", { name: "喜欢功能尚未开放" })).toBeDisabled();
  });

  it("retains daily metadata when detail and lyric reads fail, then retries", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(failure("上游服务暂时不可用。")));
    vi.stubGlobal("fetch", fetchMock);

    renderPreview({ phase: "visible" });

    expect(await screen.findByText("上游服务暂时不可用。")).toBeVisible();
    expect(screen.getByRole("heading", { name: "First Signal" })).toBeVisible();
    expect(screen.getByText("歌词摘要暂时不可用。")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });

  it("disables known unavailable playback with a truthful reason", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => (
      String(input).endsWith("/lyrics")
        ? Promise.resolve(success({ kind: "unavailable", lines: [] }))
        : Promise.resolve(success(tracks[1]))
    )));

    renderPreview({ phase: "visible", track: tracks[1] });

    const restrictedPlay = await screen.findByRole("button", {
      name: "该歌曲需要 VIP 权益，目前无法播放。",
    });
    expect(restrictedPlay).toBeDisabled();
    expect(screen.getByText("该歌曲需要 VIP 权益，目前无法播放。")).toBeVisible();
    expect(screen.getByTestId("player-probe")).toHaveTextContent("none:paused");
  });

  it("routes both visible exit controls through one idempotent parent action", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const onClose = vi.fn();
    renderPreview({ onClose, phase: "visible" });

    fireEvent.click(screen.getByRole("button", {
      name: "关闭歌曲预览，返回每日推荐",
    }));
    fireEvent.click(screen.getByRole("button", { name: "返回每日推荐" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ignores stale detail responses after rapid target replacement", async () => {
    const pending = new Map<string, (response: Response) => void>();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => (
      new Promise<Response>((resolve) => {
        pending.set(String(input), resolve);
      })
    )));
    const sourceResolver = vi.fn(() => new Promise<never>(() => undefined));
    const preview = (track: Track) => (
      <PlayerProvider sourceResolver={sourceResolver}>
        <TrackPreviewStage
          index={tracks.findIndex((candidate) => candidate.id === track.id)}
          onClose={vi.fn()}
          onExplore={vi.fn()}
          phase="entering"
          showDomArtwork={false}
          total={tracks.length}
          track={track}
          tracks={tracks}
        />
      </PlayerProvider>
    );
    const { rerender } = render(preview(tracks[0]));

    await waitFor(() => expect(pending.size).toBe(2));
    rerender(preview(tracks[1]));
    await waitFor(() => expect(pending.size).toBe(4));

    pending.get("/api/tracks/track-002")?.(success({
      ...tracks[1],
      album: { ...tracks[1].album, name: "Current Record" },
    }));
    pending.get("/api/tracks/track-002/lyrics")?.(success({ kind: "unavailable", lines: [] }));
    pending.get("/api/tracks/track-001")?.(success({
      ...tracks[0],
      album: { ...tracks[0].album, name: "Stale Record" },
    }));
    pending.get("/api/tracks/track-001/lyrics")?.(success({ kind: "unavailable", lines: [] }));

    expect(await screen.findByText("Current Record")).toBeVisible();
    expect(screen.queryByText("Stale Record")).not.toBeInTheDocument();
  });
});
