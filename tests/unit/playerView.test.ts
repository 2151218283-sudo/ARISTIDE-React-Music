import { describe, expect, it } from "vitest";

import {
  formatPlayerTime,
  nextPlaybackMode,
  playbackModeLabel,
  playerStatusLabel,
} from "../../src/features/player/playerView";
import { playerError } from "../../src/lib/player";

describe("player view formatting", () => {
  it("formats known, long, and unknown time values", () => {
    expect(formatPlayerTime(0)).toBe("0:00");
    expect(formatPlayerTime(65_999)).toBe("1:05");
    expect(formatPlayerTime(3_661_000)).toBe("61:01");
    expect(formatPlayerTime(null)).toBe("--:--");
    expect(formatPlayerTime(Number.NaN)).toBe("--:--");
    expect(formatPlayerTime(-1)).toBe("--:--");
  });

  it("cycles and labels the three playback modes in one order", () => {
    expect(nextPlaybackMode("sequential")).toBe("shuffle");
    expect(nextPlaybackMode("shuffle")).toBe("repeat-one");
    expect(nextPlaybackMode("repeat-one")).toBe("sequential");
    expect(playbackModeLabel("sequential")).toBe("顺序播放");
    expect(playbackModeLabel("shuffle")).toBe("随机播放");
    expect(playbackModeLabel("repeat-one")).toBe("单曲循环");
  });
});

describe("player status priority", () => {
  it("prioritizes actionable errors over transport status", () => {
    expect(playerStatusLabel({
      error: playerError("AUTOPLAY_BLOCKED", "blocked", { fatal: false }),
      networkStatus: "idle",
      playbackStatus: "paused",
      queueLength: 1,
    })).toBe("自动播放已被阻止，请手动播放");

    expect(playerStatusLabel({
      error: playerError("TRACK_UNAVAILABLE", "当前歌曲不可播放。"),
      networkStatus: "stalled",
      playbackStatus: "error",
      queueLength: 2,
    })).toBe("当前歌曲不可播放。");
  });

  it("distinguishes stalled, buffering, loading, playback, and empty status", () => {
    const status = (
      playbackStatus: Parameters<typeof playerStatusLabel>[0]["playbackStatus"],
      networkStatus: Parameters<typeof playerStatusLabel>[0]["networkStatus"] = "idle",
      queueLength = 1,
    ) => playerStatusLabel({
      error: null,
      networkStatus,
      playbackStatus,
      queueLength,
    });

    expect(status("playing", "stalled")).toBe("连接停滞，正在尝试恢复");
    expect(status("playing", "buffering")).toBe("正在缓冲");
    expect(status("loading")).toBe("正在准备音频");
    expect(status("playing")).toBe("正在播放");
    expect(status("paused")).toBe("已暂停");
    expect(status("ended")).toBe("队列播放结束");
    expect(status("ready", "idle", 0)).toBe("队列中没有下一首");
    expect(status("ready")).toBe("准备播放");
  });
});
