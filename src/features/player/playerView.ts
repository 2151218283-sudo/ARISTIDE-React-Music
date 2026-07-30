import type {
  NetworkStatus,
  PlaybackMode,
  PlaybackStatus,
  PlayerError,
} from "@/lib/player";

export function formatPlayerTime(timeMs: number | null): string {
  if (timeMs === null || !Number.isFinite(timeMs) || timeMs < 0) {
    return "--:--";
  }

  const totalSeconds = Math.floor(timeMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function nextPlaybackMode(mode: PlaybackMode): PlaybackMode {
  if (mode === "sequential") {
    return "shuffle";
  }
  if (mode === "shuffle") {
    return "repeat-one";
  }
  return "sequential";
}

export function playbackModeLabel(mode: PlaybackMode): string {
  if (mode === "shuffle") {
    return "随机播放";
  }
  if (mode === "repeat-one") {
    return "单曲循环";
  }
  return "顺序播放";
}

interface PlayerStatusLabelInput {
  error: PlayerError | null;
  networkStatus: NetworkStatus;
  playbackStatus: PlaybackStatus;
  queueLength: number;
}

export function playerStatusLabel({
  error,
  networkStatus,
  playbackStatus,
  queueLength,
}: PlayerStatusLabelInput): string {
  if (error?.code === "AUTOPLAY_BLOCKED") {
    return "自动播放已被阻止，请手动播放";
  }
  if (playbackStatus === "error" && error) {
    return error.message;
  }
  if (networkStatus === "stalled") {
    return "连接停滞，正在尝试恢复";
  }
  if (networkStatus === "buffering") {
    return "正在缓冲";
  }
  if (playbackStatus === "loading") {
    return "正在准备音频";
  }
  if (playbackStatus === "playing") {
    return "正在播放";
  }
  if (playbackStatus === "paused") {
    return "已暂停";
  }
  if (playbackStatus === "ended") {
    return "队列播放结束";
  }
  if (queueLength === 0) {
    return "队列中没有下一首";
  }
  return "准备播放";
}
