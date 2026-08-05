"use client";

import { LocateFixed } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";

import { Skeleton } from "@/components/Skeleton";
import { StatusView } from "@/components/StatusView";
import { TextButton } from "@/components/TextButton";
import {
  findActiveLyricLine,
  findActiveLyricWord,
} from "@/lib/player";
import type { LyricDocument, LyricLine } from "@/lib/music/models";

import {
  usePlayerDispatch,
  usePlayerSelector,
  usePlayerTimelineSelector,
} from "./playerContext";
import { formatPlayerTime } from "./playerView";
import type { TrackPageResource } from "./useTrackPageDetails";
import styles from "./LyricsViewport.module.css";

const browseLockDurationMs = 5_000;

function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) {
      return undefined;
    }

    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

function LyricText({
  activeWord,
  line,
}: {
  activeWord: number | null;
  line: LyricLine;
}) {
  if (!line.words) {
    return <span>{line.text}</span>;
  }

  return line.words.map((word, wordIndex) => (
    <span
      className={styles.word}
      data-active={activeWord === wordIndex || undefined}
      data-complete={activeWord !== null && wordIndex < activeWord || undefined}
      key={`${word.startMs}:${wordIndex}`}
    >
      {word.text}
    </span>
  ));
}

function EmptyLyrics({ kind }: { kind: LyricDocument["kind"] }) {
  const copy = kind === "instrumental"
    ? "纯音乐作品，暂未提供歌词。"
    : "这首歌曲暂未提供歌词。";

  return (
    <div className={styles.empty} data-lyrics-kind={kind} role="status">
      <p>{copy}</p>
    </div>
  );
}

interface LyricsViewportProps {
  lyrics: TrackPageResource<LyricDocument>;
}

export function LyricsViewport({ lyrics }: LyricsViewportProps) {
  const currentTimeMs = usePlayerTimelineSelector((snapshot) => snapshot.currentTimeMs);
  const currentTrack = usePlayerSelector((snapshot) => snapshot.currentTrack);
  const durationMs = usePlayerSelector((snapshot) => snapshot.durationMs);
  const dispatch = usePlayerDispatch();
  const reducedMotion = useReducedMotion();
  const lineRefs = useRef(new Map<number, HTMLButtonElement>());
  const browseTimerRef = useRef<number | null>(null);
  const autoScrollUntilRef = useRef(0);
  const [browseLocked, setBrowseLocked] = useState(false);
  const [followRevision, setFollowRevision] = useState(0);

  const document = lyrics.data;
  const lines = useMemo(() => document?.lines ?? [], [document]);
  const canSynchronize = document?.kind === "synced" && currentTrack !== null;
  const activeLine = useMemo(
    () => canSynchronize ? findActiveLyricLine(lines, currentTimeMs) : null,
    [canSynchronize, currentTimeMs, lines],
  );
  const activeWords = useMemo(() => lines.map((line) => (
    findActiveLyricWord(line.words, currentTimeMs)
  )), [currentTimeMs, lines]);
  const clearBrowseTimer = useCallback(() => {
    if (browseTimerRef.current !== null) {
      window.clearTimeout(browseTimerRef.current);
      browseTimerRef.current = null;
    }
  }, []);

  const beginBrowseLock = useCallback(() => {
    if (!canSynchronize) {
      return;
    }

    clearBrowseTimer();
    setBrowseLocked(true);
    browseTimerRef.current = window.setTimeout(() => {
      browseTimerRef.current = null;
      setBrowseLocked(false);
      setFollowRevision((revision) => revision + 1);
    }, browseLockDurationMs);
  }, [canSynchronize, clearBrowseTimer]);

  const returnToCurrent = useCallback(() => {
    clearBrowseTimer();
    setBrowseLocked(false);
    setFollowRevision((revision) => revision + 1);
  }, [clearBrowseTimer]);

  useEffect(() => () => clearBrowseTimer(), [clearBrowseTimer]);

  useEffect(() => {
    if (activeLine === null || browseLocked) {
      return;
    }

    const line = lineRefs.current.get(activeLine);
    if (!line) {
      return;
    }

    if (typeof line.scrollIntoView === "function") {
      autoScrollUntilRef.current = Date.now() + (reducedMotion ? 80 : 650);
      line.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "center",
        inline: "nearest",
      });
    }
  }, [activeLine, browseLocked, followRevision, reducedMotion]);

  const onScroll = (): void => {
    if (Date.now() >= autoScrollUntilRef.current) {
      beginBrowseLock();
    }
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (event.deltaY !== 0 || event.deltaX !== 0) {
      beginBrowseLock();
    }
  };

  if (lyrics.status === "idle" || lyrics.status === "loading") {
    return (
      <section aria-label="同步歌词" className={styles.viewport} data-lyrics-state="loading">
        <div className={styles.heading}>
          <p>LYRICS</p>
          <span>正在读取歌词</span>
        </div>
        <div className={styles.skeletonLines} aria-label="歌词加载中" role="status">
          <Skeleton variant="line" />
          <Skeleton variant="line-short" />
          <Skeleton variant="line" />
        </div>
      </section>
    );
  }

  if (lyrics.status === "error") {
    return (
      <section aria-label="同步歌词" className={styles.viewport} data-lyrics-state="error">
        <div className={styles.heading}>
          <p>LYRICS</p>
        </div>
        <StatusView
          action={{
            label: "重试",
            onClick: lyrics.retry,
          }}
          description={lyrics.error?.message ?? "歌词暂时不可用。"}
          title="歌词未能加载"
          tone="error"
          variant="inline"
        />
      </section>
    );
  }

  if (!document || document.kind === "instrumental" || document.kind === "unavailable") {
    return (
      <section aria-label="同步歌词" className={styles.viewport} data-lyrics-state="empty">
        <div className={styles.heading}>
          <p>LYRICS</p>
        </div>
        <EmptyLyrics kind={document?.kind ?? "unavailable"} />
      </section>
    );
  }

  if (document.kind === "plain") {
    return (
      <section aria-label="歌词" className={styles.viewport} data-lyrics-state="plain">
        <div className={styles.heading}>
          <p>LYRICS</p>
          <span>文本歌词</span>
        </div>
        <div className={styles.plainLines}>
          {lines.map((line, index) => <p key={`${index}:${line.text}`}>{line.text}</p>)}
        </div>
      </section>
    );
  }

  return (
    <section aria-label="同步歌词" className={styles.viewport} data-lyrics-state="synced">
      <div className={styles.heading}>
        <p>LYRICS</p>
        {browseLocked ? (
          <TextButton className={styles.returnButton} onClick={returnToCurrent} variant="quiet">
            <LocateFixed aria-hidden="true" />
            回到当前
          </TextButton>
        ) : <span>同步歌词</span>}
      </div>
      <div
        data-lyrics-lines
        className={styles.lines}
        onScroll={onScroll}
        onTouchMove={beginBrowseLock}
        onWheel={onWheel}
      >
        <ol>
          {lines.map((line, index) => {
            const active = activeLine === index;
            const canSeek = durationMs !== null;
            const timestamp = formatPlayerTime(line.startMs);
            return (
              <li key={`${line.startMs}:${index}`}>
                <button
                  aria-current={active ? "true" : undefined}
                  aria-label={canSeek
                    ? `跳转到 ${timestamp}：${line.text}`
                    : `${timestamp}：${line.text}，等待音频准备`}
                  className={styles.line}
                  data-active={active || undefined}
                  disabled={!canSeek}
                  onClick={() => dispatch({ type: "SEEK_COMMIT", timeMs: line.startMs })}
                  ref={(node) => {
                    if (node) {
                      lineRefs.current.set(index, node);
                    } else {
                      lineRefs.current.delete(index);
                    }
                  }}
                  type="button"
                >
                  <span className={styles.lineText}>
                    <LyricText activeWord={active ? activeWords[index] : null} line={line} />
                  </span>
                  {line.translation ? <span className={styles.translation}>{line.translation}</span> : null}
                  {line.romanization ? <span className={styles.romanization}>{line.romanization}</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {browseLocked ? (
        <p className={styles.browseStatus} role="status">
          已暂停自动跟随
        </p>
      ) : null}
    </section>
  );
}
