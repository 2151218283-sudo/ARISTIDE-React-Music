"use client";

import { useEffect, useMemo, useState } from "react";

import { Skeleton } from "@/components/Skeleton";
import { StatusView } from "@/components/StatusView";
import { TrackRow } from "@/components/TrackRow";
import { useAuth } from "@/features/auth/AuthProvider";
import { libraryChangedEventName } from "@/features/library/LibraryMutationProvider";
import {
  listScopedListeningHistory,
  listeningHistoryChangedEvent,
  listeningHistoryScope,
} from "@/lib/listeningHistory";
import type { RuleRecommendations as RuleRecommendationsData } from "@/lib/music/models";
import type { QueueItem } from "@/lib/player";

import { requestRuleRecommendations, RuleRecommendationClientError } from "./ruleRecommendationClient";
import styles from "./RuleRecommendations.module.css";

interface RecommendationFailure {
  message: string;
  requiresLogin: boolean;
}

export function RuleRecommendations() {
  const { mode, openLogin, status: authStatus, user } = useAuth();
  const [data, setData] = useState<RuleRecommendationsData | null>(null);
  const [error, setError] = useState<RecommendationFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [revision, setRevision] = useState(0);
  const identity = `${mode}:${user?.id ?? "guest"}`;

  useEffect(() => {
    const refresh = (): void => {
      setLoading(true);
      setError(null);
      setRevision((current) => current + 1);
    };
    window.addEventListener(libraryChangedEventName, refresh);
    window.addEventListener(listeningHistoryChangedEvent, refresh);
    return () => {
      window.removeEventListener(libraryChangedEventName, refresh);
      window.removeEventListener(listeningHistoryChangedEvent, refresh);
    };
  }, []);

  useEffect(() => {
    if (authStatus !== "ready" || mode !== "real" || !user) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => setShowSkeleton(true), 300);
    void listScopedListeningHistory(listeningHistoryScope(mode, user.id))
      .then((entries) => requestRuleRecommendations(entries
        .filter((entry) => entry.playedAt >= Date.now() - 30 * 24 * 60 * 60 * 1_000)
        .slice(0, 50)
        .map((entry) => ({ trackId: entry.trackId, playedAt: entry.playedAt })), controller.signal))
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure instanceof RuleRecommendationClientError
          ? { message: failure.message, requiresLogin: failure.requiresLogin }
          : { message: "无法读取本地历史或规则推荐，请重试。", requiresLogin: false });
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setShowSkeleton(false);
          window.clearTimeout(timer);
        }
      });
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [authStatus, identity, mode, revision, user]);

  const queue = useMemo<QueueItem[]>(() => (data?.items ?? []).map((item) => ({
    queueItemId: `rules:${item.track.id}`,
    sourceContext: "search",
    track: item.track,
  })), [data]);

  return (
    <section aria-labelledby="rule-recommendations-heading" className={styles.section}>
      <div className={styles.header}>
        <h2 id="rule-recommendations-heading">根据你的喜欢与最近播放</h2>
        <span>本站规则推荐</span>
      </div>
      {authStatus === "loading" || loading && showSkeleton && !data ? (
        <div aria-label="正在加载规则推荐" className={styles.skeleton} role="status">
          <Skeleton variant="block" /><Skeleton variant="block" /><Skeleton variant="block" />
        </div>
      ) : null}
      {authStatus === "ready" && mode === "demo" ? <p className={styles.note}>演示模式没有真实喜欢与可播相似曲，不显示 Real 推荐。</p> : null}
      {authStatus === "ready" && mode === "real" && !user ? <StatusView action={{ label: "扫码登录", onClick: openLogin }} description="登录后才能使用当前账号的喜欢歌曲生成推荐。" title="登录后查看推荐" tone="empty" variant="inline" /> : null}
      {mode === "real" && user && data ? (
        <>
          <p className={styles.note}>来源：当前喜欢歌曲 {data.likedSampleSize} 首、近 30 天本站有效播放 {data.historySampleSize} 首；结果日期 {data.date}。播放前仍会再次检查音源。</p>
          {data.failedSeedCount > 0 ? <p className={styles.warning} role="status">{data.failedSeedCount} 个种子暂时未能读取，以下是其余种子的结果。</p> : null}
          {data.failedAvailabilityCount > 0 ? <p className={styles.warning} role="status">{data.failedAvailabilityCount} 首候选暂时无法验证可播性，已从本次结果中排除。</p> : null}
          {data.items.length > 0 ? <div className={styles.list}>{data.items.map((item) => (
            <div className={styles.item} key={item.track.id}>
              <TrackRow queue={queue} track={item.track} />
              <p className={styles.reason}>依据：{item.reasons.map((reason) => `${reason.source === "liked" ? "喜欢" : "本地播放"}「${reason.seedName}」`).join("、")}</p>
            </div>
          ))}</div> : <p className={styles.note}>{data.historySampleSize + data.likedSampleSize === 0
            ? "还没有可用于推荐的喜欢歌曲或当前身份有效播放记录。"
            : "当前样本没有找到可播放的相似歌曲。"}</p>}
        </>
      ) : null}
      {mode === "real" && user && error ? <StatusView action={error.requiresLogin
        ? { label: "重新扫码", onClick: openLogin }
        : { label: "重试推荐", onClick: () => {
        setLoading(true);
        setError(null);
        setRevision((current) => current + 1);
      } }} description={error.message} title={error.requiresLogin ? "登录状态已失效" : "规则推荐暂时不可用"} tone="error" variant="inline" /> : null}
    </section>
  );
}
