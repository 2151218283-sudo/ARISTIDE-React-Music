"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { RuleRecommendations } from "@/features/discovery/RuleRecommendations";

import { PlaylistTile } from "@/components/PlaylistTile";
import { Skeleton } from "@/components/Skeleton";
import { StatusView } from "@/components/StatusView";
import { TrackRow } from "@/components/TrackRow";
import type { CatalogPage, Playlist, Track } from "@/lib/music/models";
import type { HotSearchTerm } from "@/lib/music/models";
import type { QueueItem } from "@/lib/player";

import {
  CatalogClientError,
  requestNewSongs,
  requestPopularPlaylists,
} from "@/features/catalog/catalogClient";
import styles from "./SearchDiscoveryLanding.module.css";
import { getRecentSearches, searchScope, subscribeRecentSearches } from "./recentSearches";
import { requestHotSearches, SearchClientError } from "./searchClient";

interface DiscoveryFailure {
  message: string;
  retryable: boolean;
}

interface DiscoverySection<T> {
  data: T | null;
  failure: DiscoveryFailure | null;
  status: "loading" | "ready" | "error";
}

const loadingSection = <T,>(): DiscoverySection<T> => ({
  data: null,
  failure: null,
  status: "loading",
});

function toFailure(error: unknown): DiscoveryFailure {
  if (error instanceof CatalogClientError) {
    return { message: error.message, retryable: error.retryable };
  }
  return { message: "发现服务暂时不可用。", retryable: true };
}

function searchQueue(tracks: readonly Track[]): QueueItem[] {
  return tracks.map((track, index) => ({
    queueItemId: `search-discovery:${track.id}:${index}`,
    sourceContext: "search",
    track,
  }));
}

function DiscoverySkeleton({ kind }: { kind: "tracks" | "playlists" }) {
  return (
    <div aria-label={kind === "tracks" ? "正在加载新歌" : "正在加载热门歌单"} className={styles.skeleton} role="status">
      {kind === "tracks" ? (
        <>
          <Skeleton variant="block" />
          <Skeleton variant="block" />
          <Skeleton variant="block" />
        </>
      ) : (
        <div className={styles.playlistSkeletons}>
          <Skeleton variant="artwork" />
          <Skeleton variant="artwork" />
          <Skeleton variant="artwork" />
          <Skeleton variant="artwork" />
        </div>
      )}
    </div>
  );
}

export function SearchDiscoveryLanding({ onFocusInput, onSelectTerm }: {
  onFocusInput: () => void;
  onSelectTerm?: (text: string) => void;
}) {
  const { mode, user } = useAuth();
  const scope = searchScope(mode, user?.id ?? null);
  const [recent, setRecent] = useState(() => getRecentSearches(scope));
  const [hotRevision, setHotRevision] = useState(0);
  const [hot, setHot] = useState<DiscoverySection<{
    source: "real" | "demo";
    items: HotSearchTerm[];
  }>>(loadingSection);
  const [newSongRevision, setNewSongRevision] = useState(0);
  const [playlistRevision, setPlaylistRevision] = useState(0);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [newSongs, setNewSongs] = useState<DiscoverySection<Track[]>>(loadingSection);
  const [playlists, setPlaylists] = useState<DiscoverySection<CatalogPage<Playlist>>>(loadingSection);

  useEffect(() => {
    const update = (): void => setRecent(getRecentSearches(scope));
    update();
    return subscribeRecentSearches(update);
  }, [scope]);

  useEffect(() => {
    const controller = new AbortController();
    void requestHotSearches(controller.signal).then((data) => {
      if (!controller.signal.aborted) setHot({ data, failure: null, status: "ready" });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setHot({
        data: null,
        failure: error instanceof SearchClientError
          ? { message: error.message, retryable: error.retryable }
          : { message: "热搜暂时不可用。", retryable: true },
        status: "error",
      });
    });
    return () => controller.abort();
  }, [hotRevision, mode, user?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSkeleton(true), 300);
    return () => window.clearTimeout(timer);
  }, [newSongRevision, playlistRevision]);

  useEffect(() => {
    const controller = new AbortController();

    void requestNewSongs(controller.signal).then((data) => {
      if (!controller.signal.aborted) {
        setNewSongs({ data, failure: null, status: "ready" });
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setNewSongs({ data: null, failure: toFailure(error), status: "error" });
      }
    });

    return () => controller.abort();
  }, [newSongRevision]);

  useEffect(() => {
    const controller = new AbortController();

    void requestPopularPlaylists(controller.signal).then((data) => {
      if (!controller.signal.aborted) {
        setPlaylists({ data, failure: null, status: "ready" });
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setPlaylists({ data: null, failure: toFailure(error), status: "error" });
      }
    });

    return () => controller.abort();
  }, [playlistRevision]);

  const newSongQueue = useMemo(() => searchQueue(newSongs.data ?? []), [newSongs.data]);

  const retryNewSongs = (): void => {
    setShowSkeleton(false);
    setNewSongs(loadingSection());
    setNewSongRevision((revision) => revision + 1);
  };

  const retryPlaylists = (): void => {
    setShowSkeleton(false);
    setPlaylists(loadingSection());
    setPlaylistRevision((revision) => revision + 1);
  };

  const bothEmpty = newSongs.status === "ready"
    && playlists.status === "ready"
    && newSongs.data?.length === 0
    && playlists.data?.items.length === 0;
  const bothFailed = newSongs.status === "error" && playlists.status === "error";

  return (
    <section className={styles.landing} data-search-discovery>
      <p className={styles.intro}>输入歌曲、歌手或专辑关键词，开始查找音乐。</p>
      {recent.length > 0 ? (
        <section aria-labelledby="recent-searches-heading" className={styles.section}>
          <h2 id="recent-searches-heading">最近搜索</h2>
          <p className={styles.empty}>仅保留在当前标签页，刷新后清除。</p>
          <div className={styles.termList}>
            {recent.map((term) => <button key={term} onClick={() => onSelectTerm?.(term)} type="button">{term}</button>)}
          </div>
        </section>
      ) : null}
      <section aria-labelledby="hot-searches-heading" className={styles.section}>
        <div className={styles.sectionHeader}><h2 id="hot-searches-heading">热搜</h2><span>网易云实时榜单</span></div>
        {hot.status === "loading" && showSkeleton ? <DiscoverySkeleton kind="tracks" /> : null}
        {hot.status === "ready" && hot.data?.source === "demo" ? <p className={styles.empty}>演示模式不提供真实热搜榜单。</p> : null}
        {hot.status === "ready" && hot.data?.source === "real" && hot.data.items.length === 0 ? <p className={styles.empty}>当前没有可显示的热搜词。</p> : null}
        {hot.status === "ready" && hot.data?.source === "real" && hot.data.items.length > 0 ? (
          <ol className={styles.termList}>
            {hot.data.items.map((item) => <li key={item.text}><button onClick={() => onSelectTerm?.(item.text)} type="button"><span>{item.rank}.</span> {item.text}</button></li>)}
          </ol>
        ) : null}
        {hot.status === "error" ? <StatusView action={{ label: "重试热搜", onClick: () => {
          setHot(loadingSection());
          setHotRevision((current) => current + 1);
        } }} description={hot.failure?.message} title="热搜暂时不可用" tone="error" variant="inline" /> : null}
      </section>
      {bothEmpty ? (
        <StatusView
          action={{ label: "开始搜索", onClick: onFocusInput }}
          description="当前没有可展示的公开发现数据。"
          title="暂时没有公开精选"
          tone="empty"
          variant="inline"
        />
      ) : null}
      {bothFailed ? (
        <StatusView
          action={{ label: "重试新歌", onClick: retryNewSongs }}
          description="热门歌单也未能加载；你仍可直接搜索音乐。"
          secondaryAction={{ label: "重试歌单", onClick: retryPlaylists }}
          title="发现服务暂时不可用"
          tone="error"
          variant="inline"
        />
      ) : null}
      {!bothEmpty && !bothFailed ? (
        <div className={styles.sections}>
          <section className={styles.section} aria-labelledby="new-songs-heading">
            <div className={styles.sectionHeader}>
              <h2 id="new-songs-heading">新歌</h2>
              <span>公开精选</span>
            </div>
            {newSongs.status === "loading" && showSkeleton ? <DiscoverySkeleton kind="tracks" /> : null}
            {newSongs.status === "ready" && newSongs.data?.length ? (
              <div className={styles.trackList}>
                {newSongs.data.map((track) => <TrackRow key={track.id} queue={newSongQueue} track={track} />)}
              </div>
            ) : null}
            {newSongs.status === "ready" && newSongs.data?.length === 0 ? (
              <p className={styles.empty}>暂时没有可展示的新歌。</p>
            ) : null}
            {newSongs.status === "error" && newSongs.failure ? (
              <StatusView
                action={newSongs.failure.retryable
                  ? { label: "重试新歌", onClick: retryNewSongs }
                  : undefined}
                description="其他发现分区仍可继续使用。"
                title={newSongs.failure.message}
                tone="error"
                variant="inline"
              />
            ) : null}
          </section>
          <section className={styles.section} aria-labelledby="popular-playlists-heading">
            <div className={styles.sectionHeader}>
              <h2 id="popular-playlists-heading">热门歌单</h2>
              <span>公开精选</span>
            </div>
            {playlists.status === "loading" && showSkeleton ? <DiscoverySkeleton kind="playlists" /> : null}
            {playlists.status === "ready" && playlists.data?.items.length ? (
              <div className={styles.playlistGrid}>
                {playlists.data.items.map((playlist) => <PlaylistTile key={playlist.id} playlist={playlist} />)}
              </div>
            ) : null}
            {playlists.status === "ready" && playlists.data?.items.length === 0 ? (
              <p className={styles.empty}>暂时没有可展示的热门歌单。</p>
            ) : null}
            {playlists.status === "error" && playlists.failure ? (
              <StatusView
                action={playlists.failure.retryable
                  ? { label: "重试歌单", onClick: retryPlaylists }
                  : undefined}
                description="其他发现分区仍可继续使用。"
                title={playlists.failure.message}
                tone="error"
                variant="inline"
              />
            ) : null}
          </section>
        </div>
      ) : null}
      <RuleRecommendations />
    </section>
  );
}
