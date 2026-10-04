"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { TextButton } from "@/components/TextButton";
import { useAuth } from "@/features/auth/AuthProvider";
import type { ApiResult } from "@/lib/music/apiResult";
import type { CommentReplySummary } from "@/lib/music/models";

import styles from "./CommentsQueuePanel.module.css";

type SendState = "idle" | "sending" | "confirmed" | "rejected" | "uncertain";

export function CommentComposer({ trackId, replyTo, onCancelReply, onConfirmed, onRefresh }: {
  trackId: string;
  replyTo?: CommentReplySummary | null;
  onCancelReply?: () => void;
  onConfirmed: () => void;
  onRefresh: () => void;
}) {
  const { mode, openLogin, status: authStatus, user } = useAuth();
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<SendState>("idle");
  const [message, setMessage] = useState("");
  const [blockedDraft, setBlockedDraft] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  if (authStatus !== "ready") return null;
  if (mode === "demo") {
    return <p className={styles.composerNotice}>演示模式不支持发表评论</p>;
  }
  if (!user) {
    return <TextButton onClick={openLogin} variant="secondary">扫码登录后发表评论</TextButton>;
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (sendingRef.current) return;
    const content = draft.trim();
    if (content.length < 1 || content.length > 1000) {
      setState("rejected");
      setMessage("评论正文须为 1 至 1000 个字符。");
      return;
    }
    if (blockedDraft === content) return;

    sendingRef.current = true;
    setState("sending");
    setMessage("正在发送评论");
    try {
      const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/comments`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          ...(replyTo ? { replyToCommentId: replyTo.id } : {}),
          clientMutationId: crypto.randomUUID().replaceAll("-", ""),
        }),
      });
      const body = await response.json() as ApiResult<{ accepted: boolean }>;
      if (!response.ok || !body.ok || body.data.accepted !== true) {
        const error = !body.ok ? body.error : null;
        if (error?.code === "AUTH_REQUIRED" || error?.code === "SESSION_EXPIRED") openLogin();
        const uncertain = !error || !["VALIDATION_ERROR", "AUTH_REQUIRED", "SESSION_EXPIRED", "RATE_LIMITED"].includes(error.code);
        setState(uncertain ? "uncertain" : "rejected");
        setMessage(uncertain ? "提交结果尚未确认，请刷新评论列表检查。" : error?.message ?? "评论未能发送。");
        if (uncertain) setBlockedDraft(content);
        return;
      }
      setDraft("");
      setBlockedDraft(null);
      setState("confirmed");
      setMessage("评论已发送，正在刷新列表。");
      onCancelReply?.();
      onConfirmed();
    } catch {
      setState("uncertain");
      setMessage("连接中断，提交结果尚未确认，请刷新评论列表检查。");
      setBlockedDraft(content);
    } finally {
      sendingRef.current = false;
    }
  };

  return (
    <form className={styles.composer} onSubmit={(event) => void submit(event)}>
      <div className={styles.composerHeading}>
        <label htmlFor="track-comment-draft">{replyTo ? `回复 @${replyTo.nickname}` : "发表评论"}</label>
        {replyTo ? <TextButton disabled={state === "sending"} onClick={onCancelReply} variant="quiet">取消回复</TextButton> : null}
      </div>
      <textarea
        id="track-comment-draft"
        maxLength={1000}
        onChange={(event) => {
          setDraft(event.target.value);
          if (state !== "sending") {
            setState("idle");
            setMessage("");
          }
        }}
        placeholder="写下你对这首歌的想法"
        readOnly={state === "sending"}
        ref={textareaRef}
        rows={3}
        value={draft}
      />
      <div className={styles.composerActions}>
        <span>{draft.length}/1000</span>
        <TextButton disabled={blockedDraft === draft.trim()} loading={state === "sending"} type="submit" variant="primary">
          {state === "sending" ? "发送中" : replyTo ? "发送回复" : "发表"}
        </TextButton>
      </div>
      {message ? <p aria-live="polite" className={styles.composerMessage} role={state === "rejected" || state === "uncertain" ? "alert" : undefined}>{message}</p> : null}
      {state === "uncertain" ? <TextButton onClick={onRefresh} variant="quiet">刷新评论列表</TextButton> : null}
    </form>
  );
}
