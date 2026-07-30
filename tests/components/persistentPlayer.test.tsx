// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { PlaybackSource, Track } from "../../src/lib/music/models";
import { playerError, type QueueItem } from "../../src/lib/player";
import { PlayerProvider } from "../../src/features/player/PlayerProvider";
import {
  usePlayerDispatch,
  usePlayerRuntime,
  usePlayerSelector,
} from "../../src/features/player/playerContext";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function track(id: string): Track {
  return {
    id,
    name: `Track ${id}`,
    artists: [{ id: `artist-${id}`, name: `Artist ${id}`, avatarUrl: null }],
    album: { id: `album-${id}`, name: `Album ${id}`, artworkUrl: null },
    durationMs: 120_000,
    artworkUrl: null,
    aliases: [],
    explicit: false,
    availability: "playable",
    privilege: { fee: 0, maxQuality: "standard" },
  };
}

function queueItem(id: string): QueueItem {
  return {
    queueItemId: `queue-${id}`,
    sourceContext: "manual",
    track: track(id),
  };
}

function source(id: string): PlaybackSource {
  return {
    url: `memory:${id}`,
    expiresAt: 9_999_999_999_999,
    quality: "standard",
    codec: "mp3",
    bitrate: 128_000,
    sampleRate: 44_100,
    sizeBytes: null,
    corsMode: "anonymous",
  };
}

const defaultQueue = [queueItem("a"), queueItem("b")];

function PlayerTestDriver({ queue = defaultQueue }: { queue?: readonly QueueItem[] }) {
  const dispatch = usePlayerDispatch();
  const runtime = usePlayerRuntime();
  const snapshot = usePlayerSelector((value) => value);

  return (
    <div>
      <button
        onClick={() => dispatch({
          type: "LOAD_TRACK",
          track: queue[0].track,
          queue,
          autoplay: false,
        })}
        type="button"
      >
        Load
      </button>
      <button
        onClick={() => dispatch({
          type: "LOAD_TRACK",
          track: queue[0].track,
          queue,
          autoplay: true,
        })}
        type="button"
      >
        Load autoplay
      </button>
      <button
        onClick={() => runtime.controller.dispatch({
          type: "SOURCE_REJECTED",
          revision: runtime.controller.getSnapshot().loadRevision,
          error: playerError("TRACK_UNAVAILABLE", "当前歌曲不可播放。", {
            retryable: true,
          }),
        })}
        type="button"
      >
        Fail source
      </button>
      <button
        onClick={() => dispatch({ type: "SET_QUEUE", queue: [] })}
        type="button"
      >
        Clear queue
      </button>
      <output data-testid="public-snapshot">{JSON.stringify(snapshot)}</output>
    </div>
  );
}

function setDuration(audio: HTMLAudioElement, durationSeconds: number): void {
  Object.defineProperty(audio, "duration", {
    configurable: true,
    value: durationSeconds,
  });
}

function renderPlayer(
  resolveSource: (value: Track) => Promise<PlaybackSource> = async (value) => source(value.id),
) {
  return render(
    <PlayerProvider sourceResolver={resolveSource}>
      <PlayerTestDriver />
    </PlayerProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("persistent player media integration", () => {
  it("uses one audio element and follows loading through real media events", async () => {
    const user = userEvent.setup();
    const request = deferred<PlaybackSource>();
    renderPlayer(() => request.promise);

    const audio = document.querySelector<HTMLAudioElement>("[data-echoform-audio]");
    const idleBar = document.querySelector<HTMLElement>("[data-player-visible='false']");
    expect(audio).not.toBeNull();
    expect(document.querySelectorAll("audio")).toHaveLength(1);
    expect(idleBar).toHaveAttribute("hidden");
    expect(document.querySelector("[data-player-spacer]")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load" }));
    const bar = document.querySelector<HTMLElement>("[data-player-visible='true']");
    expect(bar).toHaveAttribute("data-state", "loading");
    expect(screen.getByText("Track a")).toBeVisible();
    expect(screen.getByRole("button", { name: /上一首/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /下一首/ })).not.toBeDisabled();

    await act(async () => request.resolve(source("a")));
    expect(bar).toHaveAttribute("data-state", "loading");
    expect(screen.getByTestId("public-snapshot")).not.toHaveTextContent("memory:a");

    setDuration(audio as HTMLAudioElement, 120);
    fireEvent.loadedMetadata(audio as HTMLAudioElement);
    expect(bar).toHaveAttribute("data-state", "ready");
    expect(screen.getByRole("slider", { name: "播放进度" })).toHaveAttribute(
      "aria-valuetext",
      "0:00 / 2:00",
    );

    await user.click(screen.getByRole("button", { name: /播放《Track a》/ }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(bar).toHaveAttribute("data-state", "ready");

    fireEvent.play(audio as HTMLAudioElement);
    expect(bar).toHaveAttribute("data-state", "playing");
    fireEvent.waiting(audio as HTMLAudioElement);
    expect(bar).toHaveAttribute("data-network", "buffering");
    expect(screen.getByText("正在缓冲")).toBeInTheDocument();
    fireEvent.stalled(audio as HTMLAudioElement);
    expect(bar).toHaveAttribute("data-network", "stalled");
    expect(screen.getByText("连接停滞，正在尝试恢复")).toBeInTheDocument();
    fireEvent.canPlay(audio as HTMLAudioElement);
    expect(bar).toHaveAttribute("data-network", "idle");

    await user.click(screen.getByRole("button", { name: /暂停《Track a》/ }));
    expect(bar).toHaveAttribute("data-state", "paused");
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("keeps autoplay rejection paused and recoverable by a user gesture", async () => {
    const user = userEvent.setup();
    const blocked = new Error("blocked");
    blocked.name = "NotAllowedError";
    vi.mocked(HTMLMediaElement.prototype.play)
      .mockRejectedValueOnce(blocked)
      .mockResolvedValue(undefined);
    renderPlayer();

    await user.click(screen.getByRole("button", { name: "Load autoplay" }));
    const audio = document.querySelector<HTMLAudioElement>("[data-echoform-audio]");
    expect(audio).not.toBeNull();
    await waitFor(() => expect(audio).toHaveAttribute("src", "memory:a"));
    setDuration(audio as HTMLAudioElement, 120);
    fireEvent.loadedMetadata(audio as HTMLAudioElement);

    await waitFor(() => expect(
      screen.getByText("自动播放已被阻止，请手动播放"),
    ).toBeInTheDocument());
    const playButton = screen.getByRole("button", { name: /播放《Track a》/ });
    expect(playButton).not.toBeDisabled();
    await user.click(playButton);
    fireEvent.play(audio as HTMLAudioElement);
    expect(document.querySelector("[data-player-visible='true']"))
      .toHaveAttribute("data-state", "playing");
  });

  it("supports keyboard and pointer seek without committing pointer preview early", async () => {
    const user = userEvent.setup();
    renderPlayer();
    await user.click(screen.getByRole("button", { name: "Load" }));
    const audio = document.querySelector<HTMLAudioElement>("[data-echoform-audio]");
    expect(audio).not.toBeNull();
    await waitFor(() => expect(audio).toHaveAttribute("src", "memory:a"));
    setDuration(audio as HTMLAudioElement, 120);
    fireEvent.loadedMetadata(audio as HTMLAudioElement);

    const progress = screen.getByRole("slider", { name: "播放进度" });
    progress.focus();
    await user.keyboard("{ArrowRight}");
    expect((audio as HTMLAudioElement).currentTime).toBe(5);

    fireEvent.pointerDown(progress);
    fireEvent.change(progress, { target: { value: "30000" } });
    expect((audio as HTMLAudioElement).currentTime).toBe(5);
    fireEvent.timeUpdate(audio as HTMLAudioElement);
    expect(progress).toHaveValue("30000");
    fireEvent.pointerCancel(progress);
    expect((audio as HTMLAudioElement).currentTime).toBe(5);

    fireEvent.pointerDown(progress);
    fireEvent.change(progress, { target: { value: "30000" } });
    fireEvent.pointerUp(progress, { target: { value: "30000" } });
    expect((audio as HTMLAudioElement).currentTime).toBe(30);
  });

  it("controls volume, restores zero volume, and cycles all playback modes", async () => {
    const user = userEvent.setup();
    renderPlayer();
    await user.click(screen.getByRole("button", { name: "Load" }));
    const audio = document.querySelector<HTMLAudioElement>("[data-echoform-audio]");
    expect(audio).not.toBeNull();

    const volume = screen.getByRole("slider", { name: "音量" });
    fireEvent.change(volume, { target: { value: "0.2" } });
    expect((audio as HTMLAudioElement).volume).toBe(0.2);
    await user.click(screen.getByRole("button", { name: "静音" }));
    expect((audio as HTMLAudioElement).muted).toBe(true);
    await user.click(screen.getByRole("button", { name: "恢复音量" }));
    expect((audio as HTMLAudioElement).muted).toBe(false);

    fireEvent.change(volume, { target: { value: "0" } });
    await user.click(screen.getByRole("button", { name: "恢复音量" }));
    expect((audio as HTMLAudioElement).volume).toBe(0.7);

    await user.click(screen.getByRole("button", { name: /当前顺序播放/ }));
    expect(screen.getByRole("button", { name: /当前随机播放/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /当前随机播放/ }));
    expect(screen.getByRole("button", { name: /当前单曲循环/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /当前单曲循环/ }));
    expect(screen.getByRole("button", { name: /当前顺序播放/ })).toBeInTheDocument();
  });
});

describe("persistent player recovery and lifetime", () => {
  it("renders an inline unavailable error with Retry and finite Next recovery", async () => {
    const user = userEvent.setup();
    const resolver = vi.fn(async (value: Track) => source(value.id));
    renderPlayer(resolver);
    await user.click(screen.getByRole("button", { name: "Load" }));
    await waitFor(() => expect(resolver).toHaveBeenCalledOnce());
    await user.click(screen.getByRole("button", { name: "Fail source" }));

    expect(document.querySelector("[data-player-visible='true']"))
      .toHaveAttribute("data-state", "error");
    expect(screen.getAllByText("当前歌曲不可播放。")).toHaveLength(2);
    const retry = screen.getByRole("button", { name: "重试" });
    expect(retry).toBeVisible();
    await user.click(retry);
    await waitFor(() => expect(resolver).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole("button", { name: "Fail source" }));
    await user.click(screen.getByRole("button", { name: /下一首/ }));
    expect(screen.getByText("Track b")).toBeVisible();
    await waitFor(() => expect(resolver).toHaveBeenCalledTimes(3));
  });

  it("returns to the hidden idle state when the queue becomes empty", async () => {
    const user = userEvent.setup();
    renderPlayer();
    await user.click(screen.getByRole("button", { name: "Load" }));
    expect(document.querySelector("[data-player-spacer]")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear queue" }));

    expect(document.querySelector("[data-player-visible='false']")).toHaveAttribute("hidden");
    expect(document.querySelector("[data-player-spacer]")).not.toBeInTheDocument();
  });

  it("preserves the audio node and selected track when child routes rerender", async () => {
    const resolver = vi.fn(async (value: Track) => source(value.id));
    const view = render(
      <PlayerProvider sourceResolver={resolver}>
        <div data-testid="route">home</div>
        <PlayerTestDriver />
      </PlayerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    await waitFor(() => expect(resolver).toHaveBeenCalledOnce());
    const initialAudio = document.querySelector("[data-echoform-audio]");

    view.rerender(
      <PlayerProvider sourceResolver={resolver}>
        <div data-testid="route">search</div>
        <PlayerTestDriver />
      </PlayerProvider>,
    );

    expect(screen.getByTestId("route")).toHaveTextContent("search");
    expect(document.querySelector("[data-echoform-audio]")).toBe(initialAudio);
    expect(screen.getByText("Track a")).toBeVisible();
    expect(document.querySelectorAll("audio")).toHaveLength(1);
  });
});
