"use client";

import { Minus, Plus, RotateCcw, TimerOff } from "lucide-react";
import { useEffect, useState } from "react";

import { useTheme, type ThemePreference } from "@/components/ThemeProvider";
import {
  usePlayerDispatch,
  usePlayerSelector,
  usePlayerTimelineSelector,
} from "@/features/player/playerContext";
import type { AudioQuality } from "@/lib/music/models";
import type { PlaybackMode } from "@/lib/player";

import { useSettings } from "./SettingsProvider";
import styles from "./SettingsExperience.module.css";

const themes: { value: ThemePreference; label: string }[] = [
  { value: "ink", label: "INK" },
  { value: "paper", label: "PAPER" },
  { value: "artwork", label: "ARTWORK" },
];
const qualities: { value: AudioQuality; label: string }[] = [
  { value: "standard", label: "标准" },
  { value: "exhigh", label: "较高" },
  { value: "lossless", label: "无损" },
  { value: "hires", label: "Hi-Res" },
];
const modes: { value: PlaybackMode; label: string }[] = [
  { value: "sequential", label: "顺序播放" },
  { value: "shuffle", label: "随机播放" },
  { value: "repeat-one", label: "单曲循环" },
];
const timerMinutes = [15, 30, 45, 60] as const;
type TimerChoice = (typeof timerMinutes)[number] | "end-of-track";

function formatRemaining(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function SettingError({ message }: { message?: string | null }) {
  return message ? <p className={styles.error} role="alert">{message}</p> : null;
}

export function SettingsExperience() {
  const { preferences, hydrated, issue, errors, setPreference, reset } = useSettings();
  const theme = useTheme();
  const dispatch = usePlayerDispatch();
  const playerMode = usePlayerSelector((snapshot) => snapshot.mode);
  const volume = usePlayerSelector((snapshot) => snapshot.volume);
  const currentTrack = usePlayerSelector((snapshot) => snapshot.currentTrack);
  const timer = usePlayerSelector((snapshot) => snapshot.sleepTimer);
  const currentTimeMs = usePlayerTimelineSelector((snapshot) => snapshot.currentTimeMs);
  const durationMs = usePlayerTimelineSelector((snapshot) => snapshot.durationMs);
  const [choice, setChoice] = useState<TimerChoice>(15);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timer || timer.kind !== "after-duration") return undefined;
    const update = () => setNow(Date.now());
    update();
    const interval = window.setInterval(update, 1_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
    };
  }, [timer]);

  const issueMessage = issue === "invalid"
    ? "部分本地设置已损坏，已使用可用值及默认值；下次修改将保存修复后的设置。"
    : issue === "future"
      ? "检测到较新版本的本地设置；本次更改不会覆盖它。可恢复默认设置。"
      : issue === "unavailable"
        ? "无法访问本地存储；设置暂时只在当前页面有效。"
        : null;
  const timerDescription = timer?.kind === "after-duration"
    ? `剩余 ${formatRemaining(timer.firesAt - now)}`
    : timer?.kind === "end-of-track"
      ? durationMs === null
        ? "将在当前歌曲自然结束时停止"
        : `当前歌曲结束后停止，约 ${formatRemaining(durationMs - currentTimeMs)}`
      : "未设置定时停止";

  if (!hydrated || !theme.hydrated) {
    return <div className={styles.page}><div className={styles.inner}><h1>设置</h1><p role="status">正在读取本地设置</p></div></div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>ECHOFORM / SETTINGS</p>
          <h1>设置</h1>
        </header>
        {issueMessage ? <p className={styles.notice} role="alert">{issueMessage}</p> : null}

        <section aria-labelledby="appearance-title" className={styles.group}>
          <h2 id="appearance-title">外观</h2>
          <div className={styles.setting}>
            <div><h3>主题</h3><p className={styles.helper}>封面主题会随当前音乐变化。</p></div>
            <div aria-label="主题" className={styles.segmented} role="group">
              {themes.map((item) => <button
                aria-pressed={theme.preference === item.value}
                disabled={!theme.available && item.value !== "ink"}
                key={item.value}
                onClick={() => theme.setPreference(item.value)}
                type="button"
              >{item.label}</button>)}
            </div>
            {!theme.available ? <p className={styles.helper}>登录 Real 账号后可使用 PAPER 或 ARTWORK。</p> : null}
            <SettingError message={theme.storageError} />
          </div>
          <label className={styles.switchRow}>
            <span><strong>减少动态</strong><small>同时保留系统的减少动态选择。</small></span>
            <input checked={preferences.reducedMotion} onChange={(event) => setPreference("reducedMotion", event.target.checked)} role="switch" type="checkbox" />
          </label>
          <SettingError message={errors.reducedMotion} />
        </section>

        <section aria-labelledby="playback-title" className={styles.group}>
          <h2 id="playback-title">播放</h2>
          <fieldset className={styles.setting}>
            <legend>默认音质</legend>
            <p className={styles.helper}>下次请求音源时生效；实际音质取决于歌曲与账号权限。</p>
            <div className={styles.options}>{qualities.map((item) => <label key={item.value}>
              <input checked={preferences.quality === item.value} name="quality" onChange={() => setPreference("quality", item.value)} type="radio" />
              {item.label}
            </label>)}</div>
            <SettingError message={errors.quality} />
          </fieldset>
          <fieldset className={styles.setting}>
            <legend>播放模式</legend>
            <div className={styles.options}>{modes.map((item) => <label key={item.value}>
              <input checked={playerMode === item.value} name="mode" onChange={() => dispatch({ type: "SET_MODE", mode: item.value })} type="radio" />
              {item.label}
            </label>)}</div>
            <SettingError message={errors.mode} />
          </fieldset>
          <label className={styles.switchRow}>
            <span><strong>记住音量</strong><small>当前音量 {Math.round(volume * 100)}%；关闭后刷新时恢复默认音量。</small></span>
            <input checked={preferences.rememberVolume} onChange={(event) => {
              setPreference("rememberVolume", event.target.checked);
            }} role="switch" type="checkbox" />
          </label>
          <SettingError message={errors.rememberVolume ?? errors.volume} />
        </section>

        <section aria-labelledby="lyrics-title" className={styles.group}>
          <h2 id="lyrics-title">歌词</h2>
          <label className={styles.switchRow}>
            <span><strong>显示翻译</strong><small>有翻译时显示在原文下方。</small></span>
            <input checked={preferences.showTranslation} onChange={(event) => setPreference("showTranslation", event.target.checked)} role="switch" type="checkbox" />
          </label>
          <SettingError message={errors.showTranslation} />
          <label className={styles.switchRow}>
            <span><strong>优先逐字歌词</strong><small>无逐字时间信息时仍显示普通同步歌词。</small></span>
            <input checked={preferences.preferWordTiming} onChange={(event) => setPreference("preferWordTiming", event.target.checked)} role="switch" type="checkbox" />
          </label>
          <SettingError message={errors.preferWordTiming} />
        </section>

        <section aria-labelledby="timer-title" className={styles.group}>
          <h2 id="timer-title">定时停止</h2>
          <p aria-live="polite" className={styles.timerStatus}>{timerDescription}</p>
          <div className={styles.timerControls}>
            <label htmlFor="sleep-timer-choice">停止时间</label>
            <div className={styles.timerInput}>
              <button aria-label="减少 15 分钟" disabled={choice === "end-of-track" || choice === 15} onClick={() => setChoice(timerMinutes[Math.max(0, timerMinutes.indexOf(choice as 15) - 1)])} type="button"><Minus aria-hidden="true" /></button>
              <select id="sleep-timer-choice" onChange={(event) => setChoice(event.target.value === "end-of-track" ? "end-of-track" : Number(event.target.value) as TimerChoice)} value={choice}>
                {timerMinutes.map((minutes) => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}
                <option value="end-of-track">当前歌曲结束后</option>
              </select>
              <button aria-label="增加 15 分钟" disabled={choice === "end-of-track" || choice === 60} onClick={() => setChoice(timerMinutes[Math.min(timerMinutes.length - 1, timerMinutes.indexOf(choice as 15) + 1)])} type="button"><Plus aria-hidden="true" /></button>
            </div>
            <div className={styles.actions}>
              <button disabled={choice === "end-of-track" && !currentTrack} onClick={() => dispatch({
                type: "SET_SLEEP_TIMER",
                timer: choice === "end-of-track"
                  ? { kind: "end-of-track" }
                  : { kind: "after-duration", firesAt: Date.now() + choice * 60_000 },
              })} type="button">{timer ? "重新计时" : "开始计时"}</button>
              <button disabled={!timer} onClick={() => dispatch({ type: "SET_SLEEP_TIMER", timer: null })} type="button"><TimerOff aria-hidden="true" />取消</button>
            </div>
          </div>
        </section>

        <div className={styles.reset}>
          <button onClick={() => { reset(); theme.setPreference("artwork"); }} type="button"><RotateCcw aria-hidden="true" />恢复默认设置</button>
        </div>
      </div>
    </div>
  );
}
