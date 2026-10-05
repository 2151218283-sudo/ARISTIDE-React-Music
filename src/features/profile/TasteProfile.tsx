"use client";

import { useEffect, useState } from "react";

import { Skeleton } from "@/components/Skeleton";
import { StatusView } from "@/components/StatusView";
import { useAuth } from "@/features/auth/AuthProvider";
import { libraryChangedEventName } from "@/features/library/LibraryMutationProvider";
import { requestLikedTracksPage } from "@/features/library/libraryClient";
import {
  listScopedListeningHistory,
  listeningHistoryChangedEvent,
  listeningHistoryScope,
  toTrack,
} from "@/lib/listeningHistory";
import { buildTasteProfile, type TasteProfile as TasteProfileData } from "@/lib/music/ruleRecommendation";
import type { Track } from "@/lib/music/models";

import styles from "./TasteProfile.module.css";

interface TasteState {
  profile: TasteProfileData | null;
  likedCount: number;
  historyCount: number;
}

async function readAllLikedTracks(signal: AbortSignal): Promise<Track[]> {
  const tracks: Track[] = [];
  for (let page = 0; page < 20; page += 1) {
    const result = await requestLikedTracksPage(page * 50, signal);
    tracks.push(...result.items);
    if (!result.hasMore) return tracks;
  }
  throw new Error("喜欢歌曲数量超过当前安全读取上限，无法生成完整画像。");
}

export function TasteProfile({ userId }: { userId: string }) {
  const { mode, status: authStatus, user } = useAuth();
  const [data, setData] = useState<TasteState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [revision, setRevision] = useState(0);
  const currentUser = authStatus === "ready" && mode === "real" && user?.id === userId;

  useEffect(() => {
    const refresh = (): void => {
      setLoading(true);
      setFailure(null);
      setRevision((value) => value + 1);
    };
    window.addEventListener(libraryChangedEventName, refresh);
    window.addEventListener(listeningHistoryChangedEvent, refresh);
    return () => {
      window.removeEventListener(libraryChangedEventName, refresh);
      window.removeEventListener(listeningHistoryChangedEvent, refresh);
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => setShowSkeleton(true), 300);
    void Promise.all([
      readAllLikedTracks(controller.signal),
      listScopedListeningHistory(listeningHistoryScope("real", userId)),
    ]).then(([liked, history]) => {
      if (controller.signal.aborted) return;
      const recent = history.filter((entry) => entry.playedAt >= Date.now() - 30 * 24 * 60 * 60 * 1_000);
      setData({
        profile: buildTasteProfile([...liked, ...recent.map((entry) => toTrack(entry.track))]),
        likedCount: liked.length,
        historyCount: recent.length,
      });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setFailure(error instanceof Error
        && error.message.startsWith("喜欢歌曲数量超过")
        ? error.message : "画像样本未能完整读取，请重试。");
    }).finally(() => {
      if (!controller.signal.aborted) {
        setLoading(false);
        setShowSkeleton(false);
        window.clearTimeout(timer);
      }
    });
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [currentUser, revision, userId]);

  if (!currentUser) return null;
  return (
    <section aria-labelledby="taste-heading" className={styles.section}>
      <div className={styles.heading}><h2 id="taste-heading">音乐品味样本</h2><span>本站本地统计</span></div>
      {loading && showSkeleton && !data ? <div aria-label="正在加载音乐品味样本" className={styles.skeleton} role="status"><Skeleton variant="block" /><Skeleton variant="block" /><Skeleton variant="block" /></div> : null}
      {data ? <p className={styles.note}>样本：当前喜欢歌曲 {data.likedCount} 首（无收藏时间）、近 30 天本站有效播放 {data.historyCount} 首；重合歌曲只计一次，旧无归属记录不参与。</p> : null}
      {data?.profile ? <ol className={styles.categories}>{data.profile.categories.map((category) => (
        <li key={category.artistId}>
          <span>{category.name}</span>
          <span>{category.tracks} / {data.profile?.sampleSize} 首 · {category.share}%</span>
        </li>
      ))}</ol> : data && !loading ? <StatusView description="需要至少 5 首可识别歌曲及 3 位真实主歌手。" title="样本不足，暂不生成画像" tone="empty" variant="inline" /> : null}
      {failure ? <StatusView action={{ label: "重试", onClick: () => {
        setLoading(true);
        setFailure(null);
        setRevision((value) => value + 1);
      } }} description={failure} title="无法计算音乐品味样本" tone="error" variant="inline" /> : null}
    </section>
  );
}
