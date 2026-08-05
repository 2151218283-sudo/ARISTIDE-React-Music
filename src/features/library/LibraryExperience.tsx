"use client";

import { Disc3, Heart, History, ListMusic } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { PlaylistTile } from "@/components/PlaylistTile";
import { Skeleton } from "@/components/Skeleton";
import { StatusView } from "@/components/StatusView";
import { TextButton } from "@/components/TextButton";
import { TrackRow, formatTrackDuration } from "@/components/TrackRow";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  clearListeningHistory,
  listeningHistoryChangedEvent,
  listListeningHistory,
  toTrack,
  type ListeningHistoryEntry,
} from "@/lib/listeningHistory";
import type { UserPlaylistCollection } from "@/lib/music/models";
import type { QueueItem } from "@/lib/player";

import {
  ProfileClientError,
  requestUserPlaylists,
} from "@/features/profile/profileClient";
import { ClearHistoryDialog } from "./ClearHistoryDialog";
import styles from "./LibraryExperience.module.css";

const historyPageSize = 50;
const pageHeadingFocusStorageKey = "echoform:page-heading-focus";

type LibraryTab = "likes" | "albums" | "playlists" | "history";
type HistoryState = "loading" | "ready" | "empty" | "error";

const tabs: Array<{
  icon: typeof Heart;
  id: LibraryTab;
  label: string;
}> = [
  { icon: Heart, id: "likes", label: "喜欢" },
  { icon: Disc3, id: "albums", label: "专辑" },
  { icon: ListMusic, id: "playlists", label: "歌单" },
  { icon: History, id: "history", label: "播放记录" },
];

interface LibraryFailure {
  message: string;
  retryable: boolean;
}

function toFailure(error: unknown, fallback: string): LibraryFailure {
  if (error instanceof ProfileClientError) {
    return { message: error.message, retryable: error.retryable };
  }
  return { message: fallback, retryable: true };
}

function HistorySkeleton() {
  return (
    <div aria-label="正在读取本地播放记录" className={styles.historySkeleton} role="status">
      <Skeleton variant="block" />
      <Skeleton variant="block" />
      <Skeleton variant="block" />
    </div>
  );
}

function CollectionSkeleton() {
  return (
    <div aria-label="正在读取音乐库" className={styles.collectionSkeleton} role="status">
      <Skeleton variant="artwork" />
      <Skeleton variant="artwork" />
      <Skeleton variant="artwork" />
    </div>
  );
}

function PlaylistGrid({
  emptyMessage,
  playlists,
}: {
  emptyMessage: string;
  playlists: readonly UserPlaylistCollection["created"][number][];
}) {
  if (playlists.length === 0) {
    return <p className={styles.emptyCopy}>{emptyMessage}</p>;
  }

  return (
    <div className={styles.playlistGrid}>
      {playlists.map((playlist) => <PlaylistTile key={playlist.id} playlist={playlist} />)}
    </div>
  );
}

function formatPlayedAt(playedAt: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(playedAt));
}

function HistoryList({
  entries,
  offline,
  onShowMore,
  total,
}: {
  entries: readonly ListeningHistoryEntry[];
  offline: boolean;
  onShowMore: () => void;
  total: number;
}) {
  const tracks = useMemo(() => entries.map((entry) => toTrack(entry.track)), [entries]);
  const queue = useMemo<QueueItem[]>(() => tracks.map((track) => ({
    queueItemId: `history:${track.id}`,
    sourceContext: "manual",
    track,
  })), [tracks]);

  return (
    <div className={styles.historyList}>
      {offline ? <p className={styles.offlineLabel}>本地离线记录</p> : null}
      {entries.map((entry, index) => {
        const track = tracks[index];
        if (!track) {
          return null;
        }
        return (
          <div className={styles.historyEntry} key={entry.trackId}>
            <TrackRow queue={queue} track={track} />
            <p className={styles.historyMeta}>
              本地记录 · 已听 {formatTrackDuration(entry.playedMs)} ·
              {entry.completed ? " 已播完" : " 已达记录阈值"} · {formatPlayedAt(entry.playedAt)}
            </p>
          </div>
        );
      })}
      {entries.length < total ? (
        <TextButton className={styles.showMore} onClick={onShowMore} variant="secondary">
          显示更多
        </TextButton>
      ) : null}
    </div>
  );
}

function AccountTab({
  collection,
  failure,
  loading,
  onOpenLogin,
  onRetry,
  onNavigate,
  tab,
  userReady,
}: {
  collection: UserPlaylistCollection | null;
  failure: LibraryFailure | null;
  loading: boolean;
  onOpenLogin: () => void;
  onRetry: () => void;
  onNavigate: (href: string) => void;
  tab: Exclude<LibraryTab, "history">;
  userReady: boolean;
}) {
  if (!userReady) {
    return (
      <StatusView
        action={{ label: "扫码登录", onClick: onOpenLogin }}
        description="登录后才能读取与你的网易云账号关联的音乐库。"
        title="登录后查看你的音乐库"
        tone="info"
      />
    );
  }

  if (loading && !collection) {
    return <CollectionSkeleton />;
  }

  if (failure && !collection) {
    return (
      <StatusView
        action={failure.retryable ? { label: "重试", onClick: onRetry } : undefined}
        description={failure.message}
        title="无法读取音乐库"
        tone="error"
      />
    );
  }

  if (tab === "albums") {
    return (
      <StatusView
        description="收藏专辑的读取接口尚未完成验证，因此这里不会显示猜测或演示内容。"
        title="收藏专辑暂不可读取"
        tone="unavailable"
      />
    );
  }

  if (!collection) {
    return null;
  }

  if (tab === "likes") {
    return collection.liked ? (
      <div className={styles.likedGrid}>
        <PlaylistTile playlist={collection.liked} />
      </div>
    ) : (
      <StatusView
        action={{ label: "去搜索", onClick: () => onNavigate("/search") }}
        description="喜欢的音乐会保存在这里。"
        title="还没有可显示的喜欢音乐"
        tone="empty"
      />
    );
  }

  return (
    <div className={styles.playlistSections}>
      <section aria-labelledby="library-created-heading" className={styles.collectionSection}>
        <div className={styles.sectionHeading}>
          <h2 id="library-created-heading">创建的歌单</h2>
          <span>{collection.created.length} 个</span>
        </div>
        <PlaylistGrid emptyMessage="还没有创建歌单。" playlists={collection.created} />
      </section>
      <section aria-labelledby="library-subscribed-heading" className={styles.collectionSection}>
        <div className={styles.sectionHeading}>
          <h2 id="library-subscribed-heading">收藏的歌单</h2>
          <span>{collection.subscribed.length} 个</span>
        </div>
        <PlaylistGrid emptyMessage="还没有收藏歌单。" playlists={collection.subscribed} />
      </section>
    </div>
  );
}

export function LibraryExperience() {
  const { openLogin, status, user } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<LibraryTab>("likes");
  const [collection, setCollection] = useState<UserPlaylistCollection | null>(null);
  const [collectionFailure, setCollectionFailure] = useState<LibraryFailure | null>(null);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionRevision, setCollectionRevision] = useState(0);
  const [entries, setEntries] = useState<ListeningHistoryEntry[]>([]);
  const [historyFailure, setHistoryFailure] = useState<LibraryFailure | null>(null);
  const [historyState, setHistoryState] = useState<HistoryState>("loading");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [offline, setOffline] = useState(false);
  const [showHistorySkeleton, setShowHistorySkeleton] = useState(false);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(historyPageSize);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearFailure, setClearFailure] = useState<string | null>(null);
  const [clearPending, setClearPending] = useState(false);
  const [historyAnnouncement, setHistoryAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const clearHistoryTriggerRef = useRef<HTMLButtonElement>(null);

  const refreshHistory = useCallback(() => {
    setHistoryFailure(null);
    setShowHistorySkeleton(false);
    const skeletonTimer = window.setTimeout(() => setShowHistorySkeleton(true), 300);
    void listListeningHistory()
      .then((nextEntries) => {
        setEntries(nextEntries);
        setHistoryState(nextEntries.length === 0 ? "empty" : "ready");
      })
      .catch((error: unknown) => {
        setHistoryFailure(toFailure(error, "无法读取本地播放记录。"));
        setHistoryState("error");
      })
      .finally(() => {
        window.clearTimeout(skeletonTimer);
        setShowHistorySkeleton(false);
      });
  }, []);

  useLayoutEffect(() => {
    const requestedPath = window.sessionStorage.getItem(pageHeadingFocusStorageKey);
    if (requestedPath === window.location.pathname) {
      window.sessionStorage.removeItem(pageHeadingFocusStorageKey);
      headingRef.current?.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    const refreshId = window.setTimeout(refreshHistory, 0);
    return () => window.clearTimeout(refreshId);
  }, [historyRevision, refreshHistory]);

  useEffect(() => {
    const updateNetworkState = (): void => setOffline(navigator.onLine === false);
    updateNetworkState();
    window.addEventListener("offline", updateNetworkState);
    window.addEventListener("online", updateNetworkState);
    window.addEventListener(listeningHistoryChangedEvent, refreshHistory);
    return () => {
      window.removeEventListener("offline", updateNetworkState);
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener(listeningHistoryChangedEvent, refreshHistory);
    };
  }, [refreshHistory]);

  useEffect(() => {
    let controller: AbortController | null = null;
    const startId = window.setTimeout(() => {
      if (status !== "ready" || !user) {
        setCollection(null);
        setCollectionFailure(null);
        setCollectionLoading(status === "loading");
        return;
      }

      controller = new AbortController();
      setCollectionLoading(true);
      setCollectionFailure(null);
      void requestUserPlaylists(user.id, controller.signal)
        .then((nextCollection) => {
          if (!controller?.signal.aborted) {
            setCollection(nextCollection);
          }
        })
        .catch((error: unknown) => {
          if (!controller?.signal.aborted) {
            setCollectionFailure(toFailure(error, "无法读取音乐库。"));
          }
        })
        .finally(() => {
          if (!controller?.signal.aborted) {
            setCollectionLoading(false);
          }
        });
    }, 0);

    return () => {
      window.clearTimeout(startId);
      controller?.abort();
    };
  }, [collectionRevision, status, user]);

  const visibleEntries = useMemo(
    () => entries.slice(0, visibleHistoryCount),
    [entries, visibleHistoryCount],
  );
  const activeTabSpec = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const tabPanelId = `library-panel-${activeTab}`;
  const userReady = status === "ready" && user !== null;

  const retryCollection = (): void => setCollectionRevision((revision) => revision + 1);
  const retryHistory = (): void => setHistoryRevision((revision) => revision + 1);
  const closeClearDialog = (): void => {
    if (clearPending) {
      return;
    }
    setClearDialogOpen(false);
    setClearFailure(null);
  };
  const openClearDialog = (): void => {
    setHistoryAnnouncement("");
    setClearFailure(null);
    setClearDialogOpen(true);
  };
  const confirmClearHistory = (): void => {
    if (clearPending) {
      return;
    }
    setClearPending(true);
    setClearFailure(null);
    void clearListeningHistory()
      .then(() => {
        setEntries([]);
        setHistoryState("empty");
        setVisibleHistoryCount(historyPageSize);
        setClearDialogOpen(false);
        setHistoryAnnouncement("播放记录已清空。");
        window.requestAnimationFrame(() => {
          clearHistoryTriggerRef.current?.focus({ preventScroll: true });
        });
      })
      .catch((error: unknown) => {
        setClearFailure(toFailure(error, "无法清空本地播放记录。").message);
      })
      .finally(() => setClearPending(false));
  };
  const selectTab = (tab: LibraryTab): void => {
    setActiveTab(tab);
    if (tab === "history") {
      setVisibleHistoryCount(historyPageSize);
    }
  };

  return (
    <div className={styles.page} data-library-state={historyState}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>ECHOFORM / LIBRARY</p>
        <h1 data-page-heading ref={headingRef} tabIndex={-1}>音乐库</h1>
        <p className={styles.description}>保留你的本地聆听轨迹与已授权的网易云音乐库信息。</p>
      </header>

      <div aria-label="音乐库分类" className={styles.tabs} role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              aria-controls={tabPanelId}
              aria-selected={activeTab === tab.id}
              id={`library-tab-${tab.id}`}
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              role="tab"
              type="button"
            >
              <Icon aria-hidden="true" strokeWidth={1.7} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <section
        aria-labelledby={`library-tab-${activeTabSpec.id}`}
        className={styles.panel}
        id={tabPanelId}
        role="tabpanel"
      >
        <div className={styles.panelHeading}>
          <h2>{activeTabSpec.label}</h2>
          {activeTab === "history" ? (
            <div className={styles.historyHeadingActions}>
              <span>{entries.length} 条本地记录</span>
              {historyState === "ready" && entries.length > 0 ? (
                <TextButton
                  onClick={openClearDialog}
                  ref={clearHistoryTriggerRef}
                  variant="danger"
                >
                  清空记录
                </TextButton>
              ) : null}
            </div>
          ) : null}
        </div>
        {activeTab === "history" ? (
          historyState === "loading" && showHistorySkeleton ? <HistorySkeleton />
            : historyState === "empty" ? (
              <StatusView
                action={{ label: "去发现音乐", onClick: () => router.push("/") }}
                description="播放记录会出现在这里。"
                title="还没有本地播放记录"
                tone="empty"
              />
            ) : historyState === "error" ? (
              <StatusView
                action={historyFailure?.retryable ? { label: "重试", onClick: retryHistory } : undefined}
                description={historyFailure?.message}
                title="无法读取本地播放记录"
                tone="error"
              />
            ) : (
              <HistoryList
                entries={visibleEntries}
                offline={offline}
                onShowMore={() => setVisibleHistoryCount((count) => count + historyPageSize)}
                total={entries.length}
              />
            )
        ) : (
          <AccountTab
            collection={collection}
            failure={collectionFailure}
            loading={collectionLoading}
            onOpenLogin={openLogin}
            onNavigate={(href) => router.push(href)}
            onRetry={retryCollection}
            tab={activeTab}
            userReady={userReady}
          />
        )}
      </section>

      <p className={styles.historyNotice}>
        播放记录仅保存在当前浏览器，不包含音频地址，也不会同步到网易云。
      </p>
      <p aria-live="polite" className={styles.historyAnnouncement} role="status">
        {historyAnnouncement}
      </p>
      <Link className={styles.backLink} href="/">返回每日推荐</Link>
      <ClearHistoryDialog
        error={clearFailure}
        onCancel={closeClearDialog}
        onConfirm={confirmClearHistory}
        open={clearDialogOpen}
        pending={clearPending}
        triggerRef={clearHistoryTriggerRef}
      />
    </div>
  );
}
