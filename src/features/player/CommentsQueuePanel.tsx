"use client";

import {
  CircleAlert,
  ListMusic,
  MessageCircle,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { AlbumArtwork } from "@/components/AlbumArtwork";
import { IconButton } from "@/components/IconButton";
import { Skeleton } from "@/components/Skeleton";
import { StatusView } from "@/components/StatusView";
import { TextButton } from "@/components/TextButton";
import type { ApiResult } from "@/lib/music/apiResult";
import type { Comment, CommentPage, TrackAvailability } from "@/lib/music/models";
import type { QueueItem } from "@/lib/player";

import { usePlayerDispatch, usePlayerSelector } from "./playerContext";
import styles from "./CommentsQueuePanel.module.css";

type PanelKind = "comments" | "queue";
type CommentOrder = "newest" | "popular";

interface CommentsState {
  error: string | null;
  hasMore: boolean;
  items: readonly Comment[];
  nextOffset: number;
  status: "idle" | "loading" | "ready" | "error";
  total: number | null;
}

interface RemovedQueueItem {
  index: number;
  item: QueueItem;
}

const commentsPageSize = 10;

const idleCommentsState: CommentsState = {
  error: null,
  hasMore: false,
  items: [],
  nextOffset: 0,
  status: "idle",
  total: null,
};

function toPanelError(error: unknown): string {
  if (typeof error === "object" && error !== null && !Array.isArray(error)) {
    const candidate = error as { message?: unknown };
    if (typeof candidate.message === "string" && candidate.message.length > 0) {
      return candidate.message;
    }
  }

  return "评论服务暂时不可用，请重试。";
}

async function readComments(
  trackId: string,
  offset: number,
  signal: AbortSignal,
): Promise<CommentPage> {
  const query = new URLSearchParams({
    limit: String(commentsPageSize),
    offset: String(offset),
  });
  const response = await fetch(
    `/api/tracks/${encodeURIComponent(trackId)}/comments?${query.toString()}`,
    {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  const body = await response.json() as ApiResult<CommentPage>;

  if (!response.ok || !body.ok) {
    if (!body.ok) {
      throw body.error;
    }
    throw new Error("The comments response could not be loaded.");
  }

  return body.data;
}

function formatCommentDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}.${month}.${day}`;
}

function authorInitial(nickname: string): string {
  const firstCharacter = Array.from(nickname.trim())[0];
  return firstCharacter?.toUpperCase() ?? "?";
}

function trackRestriction(availability: TrackAvailability): string | null {
  if (availability === "vip") {
    return "需要会员权限";
  }
  if (availability === "copyright") {
    return "因版权限制不可播放";
  }
  if (availability === "region") {
    return "当前地区不可播放";
  }
  return null;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )).filter((element) => !element.hasAttribute("hidden"));
}

function CommentsContent({
  comments,
  onLoadMore,
  onRetry,
  order,
  onOrderChange,
}: {
  comments: CommentsState;
  onLoadMore: () => void;
  onRetry: () => void;
  order: CommentOrder;
  onOrderChange: (order: CommentOrder) => void;
}) {
  const orderedComments = useMemo(() => [...comments.items].sort((left, right) => {
    if (order === "popular") {
      const likesDifference = right.likedCount - left.likedCount;
      return likesDifference !== 0 ? likesDifference : right.createdAt - left.createdAt;
    }
    return right.createdAt - left.createdAt;
  }), [comments.items, order]);

  if (comments.status === "loading" && comments.items.length === 0) {
    return (
      <div aria-label="评论加载中" className={styles.commentSkeletons} data-comments-state="loading">
        <Skeleton variant="line-short" />
        <Skeleton variant="line" />
        <Skeleton variant="line-short" />
        <Skeleton variant="line" />
      </div>
    );
  }

  if (comments.status === "error" && comments.items.length === 0) {
    return (
      <StatusView
        action={{ label: "重试", onClick: onRetry }}
        description={comments.error ?? "评论服务暂时不可用，请重试。"}
        title="评论加载失败"
        tone="error"
        variant="inline"
      />
    );
  }

  if (comments.status === "ready" && comments.items.length === 0) {
    return (
      <div className={styles.emptyState} data-comments-state="empty">
        <p>还没有可显示的评论</p>
        <span>评论功能尚未开放</span>
        <TextButton disabled variant="quiet">登录后发表评论</TextButton>
      </div>
    );
  }

  return (
    <div className={styles.comments} data-comments-state="ready">
      <div className={styles.commentToolbar}>
        <p>{comments.total === null ? `${comments.items.length} 条已加载评论` : `${comments.total} 条评论`}</p>
        <label>
          <span className={styles.srOnly}>评论排序</span>
          <select
            aria-label="评论排序"
            onChange={(event) => onOrderChange(event.target.value as CommentOrder)}
            value={order}
          >
            <option value="newest">最新</option>
            <option value="popular">最受欢迎</option>
          </select>
        </label>
      </div>
      <ol className={styles.commentList}>
        {orderedComments.map((comment) => (
          <li className={styles.comment} key={comment.id}>
            <span aria-hidden="true" className={styles.commentAvatar}>
              {authorInitial(comment.author.nickname)}
            </span>
            <article>
              <header>
                <strong>{comment.author.nickname}</strong>
                <time dateTime={new Date(comment.createdAt).toISOString()}>
                  {formatCommentDate(comment.createdAt)}
                </time>
              </header>
              {comment.replyTo ? (
                <p className={styles.replyContext}>回复 @{comment.replyTo.nickname}</p>
              ) : null}
              <p>{comment.content}</p>
              <span className={styles.commentLikes}>赞 {comment.likedCount}</span>
            </article>
          </li>
        ))}
      </ol>
      {comments.error ? (
        <div className={styles.inlineError} role="alert">
          <CircleAlert aria-hidden="true" />
          <span>{comments.error}</span>
          <TextButton onClick={onRetry} variant="quiet">重试</TextButton>
        </div>
      ) : null}
      {comments.hasMore ? (
        <TextButton
          className={styles.loadMoreButton}
          loading={comments.status === "loading"}
          onClick={onLoadMore}
          variant="secondary"
        >
          加载更多
        </TextButton>
      ) : null}
      <div className={styles.readOnlyFooter}>
        <span>评论功能尚未开放</span>
        <TextButton disabled variant="quiet">登录后发表评论</TextButton>
      </div>
    </div>
  );
}

function QueueUndoNotice({
  removedItem,
  onUndo,
}: {
  removedItem: RemovedQueueItem | null;
  onUndo: () => void;
}) {
  if (!removedItem) {
    return null;
  }

  return (
    <div aria-live="polite" className={styles.undoNotice}>
      <span>已从队列移除《{removedItem.item.track.name}》</span>
      <TextButton onClick={onUndo} variant="quiet">
        <RotateCcw aria-hidden="true" />
        撤销
      </TextButton>
    </div>
  );
}

function QueueContent({
  onRemove,
  onSelect,
  removedItem,
  onUndo,
}: {
  onRemove: (item: QueueItem, index: number) => void;
  onSelect: (item: QueueItem) => void;
  removedItem: RemovedQueueItem | null;
  onUndo: () => void;
}) {
  const currentIndex = usePlayerSelector((snapshot) => snapshot.currentIndex);
  const playbackStatus = usePlayerSelector((snapshot) => snapshot.playbackStatus);
  const queue = usePlayerSelector((snapshot) => snapshot.queue);

  if (queue.length === 0) {
    return (
      <div className={styles.queue} data-queue-state="empty">
        <div className={styles.emptyState}>
          <p>队列中没有下一首</p>
          <Link href="/">浏览每日推荐</Link>
        </div>
        <QueueUndoNotice onUndo={onUndo} removedItem={removedItem} />
      </div>
    );
  }

  return (
    <div className={styles.queue} data-queue-state="ready">
      <p className={styles.queueSummary}>{queue.length} 首临时队列歌曲</p>
      <ol className={styles.queueList}>
        {queue.map((item, index) => {
          const isCurrent = index === currentIndex;
          const restriction = trackRestriction(item.track.availability);
          const isPlaying = isCurrent && playbackStatus === "playing";
          return (
            <li
              className={styles.queueItem}
              data-current={isCurrent || undefined}
              data-unavailable={Boolean(restriction) || undefined}
              key={item.queueItemId}
            >
              <button
                aria-current={isCurrent ? "true" : undefined}
                aria-label={restriction
                  ? `${item.track.name}，${restriction}`
                  : `${isCurrent ? "当前歌曲，" : "播放"}${item.track.name}`}
                className={styles.queueTrack}
                disabled={Boolean(restriction)}
                onClick={() => onSelect(item)}
                type="button"
              >
                <AlbumArtwork
                  alt=""
                  playing={isPlaying}
                  src={item.track.artworkUrl}
                  status={item.track.artworkUrl ? "loaded" : "empty"}
                  variant="thumbnail"
                />
                <span className={styles.queueTrackText}>
                  <strong>{item.track.name}</strong>
                  <span>{item.track.artists.map((artist) => artist.name).join(" / ")}</span>
                  {restriction ? <em>{restriction}</em> : null}
                </span>
                {isCurrent ? (
                  <span className={styles.currentMarker}>
                    {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                    当前
                  </span>
                ) : null}
              </button>
              <IconButton
                icon={<Trash2 aria-hidden="true" />}
                label={`从队列移除 ${item.track.name}`}
                onClick={() => onRemove(item, index)}
                size="md"
                tooltip="从队列移除"
              />
            </li>
          );
        })}
      </ol>
      <QueueUndoNotice onUndo={onUndo} removedItem={removedItem} />
    </div>
  );
}

export function CommentsQueuePanel({ trackId }: { trackId: string }) {
  const [activePanel, setActivePanel] = useState<PanelKind | null>(null);
  const [comments, setComments] = useState<CommentsState>(idleCommentsState);
  const [commentOrder, setCommentOrder] = useState<CommentOrder>("newest");
  const [removedItem, setRemovedItem] = useState<RemovedQueueItem | null>(null);
  const commentsAbortRef = useRef<AbortController | null>(null);
  const commentsRequestRef = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const commentsTriggerRef = useRef<HTMLButtonElement>(null);
  const queueTriggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTrack = usePlayerSelector((snapshot) => snapshot.currentTrack);
  const queue = usePlayerSelector((snapshot) => snapshot.queue);
  const dispatch = usePlayerDispatch();

  const clearUndo = useCallback(() => {
    if (undoTimeoutRef.current !== null) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
  }, []);

  const closePanel = useCallback(() => {
    setActivePanel(null);
    window.requestAnimationFrame(() => activeTriggerRef.current?.focus());
  }, []);

  const loadComments = useCallback((offset: number, append: boolean) => {
    commentsAbortRef.current?.abort();
    const controller = new AbortController();
    commentsAbortRef.current = controller;
    const requestVersion = commentsRequestRef.current + 1;
    commentsRequestRef.current = requestVersion;

    setComments((current) => ({
      ...current,
      error: null,
      status: "loading",
    }));

    void readComments(trackId, offset, controller.signal).then((page) => {
      if (controller.signal.aborted || commentsRequestRef.current !== requestVersion) {
        return;
      }
      setComments((current) => ({
        error: null,
        hasMore: page.hasMore,
        items: append ? [...current.items, ...page.items] : page.items,
        nextOffset: page.offset + page.items.length,
        status: "ready",
        total: page.total,
      }));
    }).catch((error: unknown) => {
      if (controller.signal.aborted || commentsRequestRef.current !== requestVersion) {
        return;
      }
      setComments((current) => ({
        ...current,
        error: toPanelError(error),
        status: current.items.length > 0 ? "ready" : "error",
      }));
    });
  }, [trackId]);

  const retryComments = useCallback(() => {
    const shouldAppend = comments.items.length > 0;
    loadComments(shouldAppend ? comments.nextOffset : 0, shouldAppend);
  }, [comments.items.length, comments.nextOffset, loadComments]);

  useEffect(() => {
    commentsAbortRef.current?.abort();
    commentsRequestRef.current += 1;
    clearUndo();
    queueMicrotask(() => {
      setComments(idleCommentsState);
      setRemovedItem(null);
    });
  }, [clearUndo, trackId]);

  useEffect(() => () => {
    commentsAbortRef.current?.abort();
    clearUndo();
  }, [clearUndo]);

  useEffect(() => {
    if (activePanel !== "comments" || comments.status !== "idle") {
      return;
    }
    queueMicrotask(() => loadComments(0, false));
  }, [activePanel, comments.status, loadComments]);

  useEffect(() => {
    if (!activePanel) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activePanel, closePanel]);

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Tab") {
      return;
    }

    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const focusable = focusableElements(panel);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable.at(-1);
    if (!last) {
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const openPanel = (kind: PanelKind): void => {
    const trigger = kind === "comments" ? commentsTriggerRef.current : queueTriggerRef.current;
    activeTriggerRef.current = trigger;
    setActivePanel((current) => current === kind ? null : kind);
  };

  const removeQueueItem = (item: QueueItem, index: number): void => {
    clearUndo();
    setRemovedItem({ item, index });
    dispatch({ type: "REMOVE_FROM_QUEUE", queueItemId: item.queueItemId });
    undoTimeoutRef.current = setTimeout(() => {
      setRemovedItem(null);
      undoTimeoutRef.current = null;
    }, 5_000);
  };

  const undoRemoveQueueItem = (): void => {
    if (!removedItem) {
      return;
    }
    const restoredQueue = [...queue];
    restoredQueue.splice(Math.min(removedItem.index, restoredQueue.length), 0, removedItem.item);
    dispatch({
      type: "SET_QUEUE",
      queue: restoredQueue,
      startTrackId: currentTrack?.id,
    });
    setRemovedItem(null);
    clearUndo();
  };

  const selectQueueItem = (item: QueueItem): void => {
    dispatch({
      type: "LOAD_TRACK",
      autoplay: true,
      queue,
      track: item.track,
    });
  };

  return (
    <>
      <div className={styles.triggers} role="group" aria-label="播放页辅助内容">
        <TextButton
          aria-controls="track-side-panel"
          aria-expanded={activePanel === "comments"}
          onClick={() => openPanel("comments")}
          ref={commentsTriggerRef}
          variant="quiet"
        >
          <MessageCircle aria-hidden="true" />
          评论
        </TextButton>
        <TextButton
          aria-controls="track-side-panel"
          aria-expanded={activePanel === "queue"}
          onClick={() => openPanel("queue")}
          ref={queueTriggerRef}
          variant="quiet"
        >
          <ListMusic aria-hidden="true" />
          队列
        </TextButton>
      </div>
      {activePanel ? createPortal(
        <div className={styles.layer} data-panel-kind={activePanel} data-panel-open="true">
          <button
            aria-label="关闭侧边面板"
            className={styles.backdrop}
            onClick={closePanel}
            tabIndex={-1}
            type="button"
          />
          <div
            aria-labelledby="track-side-panel-title"
            aria-modal="true"
            className={styles.panel}
            id="track-side-panel"
            onKeyDown={handlePanelKeyDown}
            ref={panelRef}
            role="dialog"
          >
            <header className={styles.panelHeader}>
              <div>
                <p>{activePanel === "comments" ? "LISTENING NOTES" : "PLAY SESSION"}</p>
                <h2 id="track-side-panel-title">{activePanel === "comments" ? "评论" : "队列"}</h2>
              </div>
              <IconButton
                icon={<X aria-hidden="true" />}
                label={`关闭${activePanel === "comments" ? "评论" : "队列"}`}
                onClick={closePanel}
                ref={closeButtonRef}
                size="md"
                tooltip="关闭"
              />
            </header>
            <div className={styles.panelBody}>
              {activePanel === "comments" ? (
                <CommentsContent
                  comments={comments}
                  onLoadMore={() => loadComments(comments.nextOffset, true)}
                  onOrderChange={setCommentOrder}
                  onRetry={retryComments}
                  order={commentOrder}
                />
              ) : (
                <QueueContent
                  onRemove={removeQueueItem}
                  onSelect={selectQueueItem}
                  onUndo={undoRemoveQueueItem}
                  removedItem={removedItem}
                />
              )}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
