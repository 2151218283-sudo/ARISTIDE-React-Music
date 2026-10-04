"use client";

import { ThumbsUp } from "lucide-react";
import { useRef, useState } from "react";

import { useAuth } from "@/features/auth/AuthProvider";
import type { ApiResult } from "@/lib/music/apiResult";
import type { Comment } from "@/lib/music/models";

import styles from "./CommentsQueuePanel.module.css";

export function CommentLikeButton({ trackId, comment, onConfirmed }: {
  trackId: string;
  comment: Comment;
  onConfirmed: () => void;
}) {
  const { mode, openLogin, status, user } = useAuth();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{
    likedBefore: boolean;
    kind: "error" | "uncertain" | "confirmed";
    text: string;
  } | null>(null);
  const pendingRef = useRef(false);
  const currentNotice = notice?.likedBefore === comment.likedByCurrentUser ? notice : null;
  const uncertain = currentNotice?.kind === "uncertain";
  const awaitingRefresh = currentNotice?.kind === "confirmed";

  const toggle = async (): Promise<void> => {
    if (pendingRef.current || uncertain || awaitingRefresh || mode === "demo" || status !== "ready") return;
    if (!user) {
      openLogin();
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/tracks/${encodeURIComponent(trackId)}/comments/${encodeURIComponent(comment.id)}/like`,
        {
          method: comment.likedByCurrentUser ? "DELETE" : "PUT",
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ clientMutationId: crypto.randomUUID().replaceAll("-", "") }),
        },
      );
      const body = await response.json() as ApiResult<{ accepted: boolean }>;
      if (!response.ok || !body.ok || body.data.accepted !== true) {
        const error = !body.ok ? body.error : null;
        if (error?.code === "AUTH_REQUIRED" || error?.code === "SESSION_EXPIRED") openLogin();
        const unknown = !error || !["VALIDATION_ERROR", "AUTH_REQUIRED", "SESSION_EXPIRED", "RATE_LIMITED"].includes(error.code);
        setNotice({
          likedBefore: comment.likedByCurrentUser,
          kind: unknown ? "uncertain" : "error",
          text: unknown ? "点赞结果尚未确认，请刷新评论列表检查。" : error?.message ?? "点赞操作失败。",
        });
        return;
      }
      setNotice({ likedBefore: comment.likedByCurrentUser, kind: "confirmed", text: "已提交，正在同步评论状态。" });
      onConfirmed();
    } catch {
      setNotice({
        likedBefore: comment.likedByCurrentUser,
        kind: "uncertain",
        text: "连接中断，点赞结果尚未确认，请刷新评论列表检查。",
      });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <div className={styles.commentLikeAction}>
      <button
        aria-label={`${comment.likedByCurrentUser ? "取消赞" : "赞"} ${comment.author.nickname} 的评论`}
        aria-pressed={comment.likedByCurrentUser}
        className={styles.commentLikeButton}
        data-pending={pending || undefined}
        disabled={pending || uncertain || awaitingRefresh || mode === "demo" || status !== "ready"}
        onClick={() => void toggle()}
        title={mode === "demo" ? "演示模式不支持评论点赞" : comment.likedByCurrentUser ? "取消赞" : "赞"}
        type="button"
      >
        <ThumbsUp aria-hidden="true" />
        <span>{pending ? "处理中" : comment.likedCount}</span>
      </button>
      {currentNotice ? <p className={styles.commentActionError} role={uncertain || !awaitingRefresh ? "alert" : "status"}>{currentNotice.text}</p> : null}
      {uncertain || awaitingRefresh ? <button className={styles.commentRefreshButton} onClick={onConfirmed} type="button">刷新评论列表</button> : null}
    </div>
  );
}
