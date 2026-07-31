// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TrackPlayerPage } from "../../src/features/player/TrackPlayerPage";
import { PlayerProvider } from "../../src/features/player/PlayerProvider";
import type { PlaybackSource, Track } from "../../src/lib/music/models";

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
  url: "memory:track-001",
  expiresAt: 9_999_999_999_999,
  quality: "standard",
  codec: "mp3",
  bitrate: 128_000,
  sampleRate: 44_100,
  sizeBytes: null,
  corsMode: "anonymous",
};

const syncedLyrics = {
  kind: "synced" as const,
  lines: [
    {
      startMs: 1_000,
      durationMs: 1_000,
      text: "Sound becomes form",
      translation: "声音成为形状",
      romanization: null,
      words: [
        { startMs: 1_000, durationMs: 400, text: "Sound " },
        { startMs: 1_400, durationMs: 600, text: "becomes form" },
      ],
    },
    {
      startMs: 2_000,
      durationMs: null,
      text: "Motion becomes memory",
      translation: null,
      romanization: null,
      words: null,
    },
  ],
};

function success(data: unknown): Response {
  return Response.json({ ok: true, data });
}

function failure(message: string): Response {
  return Response.json({
    ok: false,
    error: {
      code: "UPSTREAM_UNAVAILABLE",
      message,
      requestId: "track-page-test",
      retryable: true,
    },
  }, { status: 503 });
}

function setDuration(audio: HTMLAudioElement, durationSeconds: number): void {
  Object.defineProperty(audio, "duration", {
    configurable: true,
    value: durationSeconds,
  });
}

function renderTrackPage(
  fetchMock: (input: RequestInfo | URL) => Promise<Response>,
) {
  vi.stubGlobal("fetch", vi.fn(fetchMock));
  return render(
    <PlayerProvider sourceResolver={async () => source}>
      <TrackPlayerPage trackId={track.id} />
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

describe("TrackPlayerPage", () => {
  it("keeps a stable page skeleton until public track and lyric reads resolve", async () => {
    let resolveTrack: ((response: Response) => void) | undefined;
    let resolveLyrics: ((response: Response) => void) | undefined;
    renderTrackPage((input) => new Promise<Response>((resolve) => {
      if (String(input).endsWith("/lyrics")) {
        resolveLyrics = resolve;
      } else {
        resolveTrack = resolve;
      }
    }));

    expect(screen.getByLabelText("完整播放页加载中")).toBeVisible();
    resolveTrack?.(success(track));
    resolveLyrics?.(success(syncedLyrics));

    expect(await screen.findByRole("heading", { name: track.name })).toBeVisible();
    expect(await screen.findByRole("button", {
      name: "0:01：Sound becomes form，等待音频准备",
    })).toBeVisible();
    expect(screen.getByRole("button", { name: `播放 ${track.name}` })).toBeEnabled();
    expect(document.querySelectorAll("audio")).toHaveLength(1);
  });

  it("keeps resolved track controls usable when lyrics fail and retries only lyrics", async () => {
    let lyricAttempts = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith("/lyrics")) {
        lyricAttempts += 1;
        return Promise.resolve(lyricAttempts === 1
          ? failure("歌词服务暂时不可用。")
          : success({ kind: "plain", lines: [{
            startMs: 0,
            durationMs: null,
            text: "A plain lyric",
            translation: null,
            romanization: null,
            words: null,
          }] }));
      }
      return Promise.resolve(success(track));
    });
    renderTrackPage(fetchMock);

    expect(await screen.findByRole("heading", { name: track.name })).toBeVisible();
    expect(await screen.findByText("歌词服务暂时不可用。")).toBeVisible();
    expect(screen.getByRole("button", { name: `播放 ${track.name}` })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("A plain lyric")).toBeVisible();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/lyrics")))
      .toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([input]) => !String(input).endsWith("/lyrics")))
      .toHaveLength(1);
  });

  it("syncs word and line lyrics to the persistent audio clock, seeks, and exposes browse lock", async () => {
    renderTrackPage((input) => Promise.resolve(
      String(input).endsWith("/lyrics") ? success(syncedLyrics) : success(track),
    ));

    await screen.findByRole("heading", { name: track.name });
    fireEvent.click(screen.getByRole("button", { name: `播放 ${track.name}` }));
    const audio = document.querySelector<HTMLAudioElement>("[data-echoform-audio]");
    expect(audio).not.toBeNull();
    await waitFor(() => expect(audio).toHaveAttribute("src", source.url));
    setDuration(audio as HTMLAudioElement, 183);
    fireEvent.loadedMetadata(audio as HTMLAudioElement);

    (audio as HTMLAudioElement).currentTime = 1.5;
    fireEvent.timeUpdate(audio as HTMLAudioElement);
    const activeLine = await screen.findByRole("button", {
      name: "跳转到 0:01：Sound becomes form",
    });
    expect(activeLine).toHaveAttribute("data-active", "true");
    expect(screen.getByText("becomes form")).toHaveAttribute("data-active", "true");

    fireEvent.click(screen.getByRole("button", {
      name: "跳转到 0:02：Motion becomes memory",
    }));
    expect((audio as HTMLAudioElement).currentTime).toBe(2);

    const lyricScroller = document.querySelector<HTMLElement>("[data-lyrics-lines]");
    expect(lyricScroller).not.toBeNull();
    fireEvent.wheel(lyricScroller as HTMLElement, { deltaY: 24 });
    expect(screen.getByRole("button", { name: "回到当前" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "回到当前" }));
    expect(screen.queryByRole("button", { name: "回到当前" })).not.toBeInTheDocument();
  });

  it("renders instrumental and unavailable lyrics as normal, non-error states", async () => {
    renderTrackPage((input) => Promise.resolve(
      String(input).endsWith("/lyrics")
        ? success({ kind: "instrumental", lines: [] })
        : success(track),
    ));

    expect(await screen.findByText("纯音乐作品，暂未提供歌词。")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
