"use client";

import { ArrowLeft, Pencil, Plus, Share2, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { AlbumArtwork } from "@/components/AlbumArtwork";
import { Skeleton } from "@/components/Skeleton";
import { StatusView } from "@/components/StatusView";
import { TextButton } from "@/components/TextButton";
import { TrackRow } from "@/components/TrackRow";
import { useAuth } from "@/features/auth/AuthProvider";
import { LibraryActionButton } from "./LibraryActionButton";
import { dispatchLibraryChanged } from "./LibraryMutationProvider";
import {
  changePlaylistTracks,
  createMutationId,
  deletePlaylist,
  PlaylistClientError,
  requestPlaylist,
  updatePlaylist,
} from "./playlistClient";
import type { PlaylistDetail, PlaylistUpdate } from "@/lib/music/models";
import type { QueueItem } from "@/lib/player";

import styles from "./PlaylistExperience.module.css";

interface PlaylistExperienceProps { playlistId: string }
type Confirmation = { kind: "delete" } | { kind: "remove"; trackId: string; trackName: string } | { kind: "publish" };

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    "button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])",
  ));
}

export function PlaylistExperience({ playlistId }: PlaylistExperienceProps) {
  const router = useRouter();
  const { mode, openLogin, status: authStatus, user } = useAuth();
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PlaylistClientError | null>(null);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<typeof user>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTags, setEditTags] = useState("");
  const editNameRef = useRef<HTMLInputElement>(null);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);
  const confirmationCancel = useRef<HTMLButtonElement>(null);
  const confirmationDialog = useRef<HTMLDivElement>(null);
  const tracksHeading = useRef<HTMLHeadingElement>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const start = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void requestPlaylist(playlistId, controller.signal)
        .then((value) => { if (!controller.signal.aborted) setDetail(value); })
        .catch((caught: unknown) => {
          if (!controller.signal.aborted) setError(caught instanceof PlaylistClientError
            ? caught : new PlaylistClientError("UPSTREAM_UNAVAILABLE", "歌单暂时无法加载。", true));
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { window.clearTimeout(start); controller.abort(); };
  }, [playlistId, revision, mode, user?.id]);

  useEffect(() => {
    if (confirmation) confirmationCancel.current?.focus();
  }, [confirmation]);

  useEffect(() => {
    if (confirmation && pending) confirmationDialog.current?.focus({ preventScroll: true });
  }, [confirmation, pending]);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const owner = mode === "real" && user?.id === detail?.playlist.owner?.id && detail?.canEdit === true;
  const editVisible = editOpen && owner && editUser === user;
  const queue = useMemo<QueueItem[]>(() => detail?.tracks.map((track, index) => ({
    queueItemId: `playlist:${playlistId}:${index}:${track.id}`,
    sourceContext: "manual",
    track,
  })) ?? [], [detail, playlistId]);

  const share = async (): Promise<void> => {
    if (!detail) return;
    const url = new URL(`/playlist/${encodeURIComponent(detail.playlist.id)}`, window.location.origin).toString();
    setNotice("");
    if (typeof navigator.share === "function") {
      try { await navigator.share({ title: detail.playlist.name, url }); setNotice("分享已完成。"); return; }
      catch { /* Copy remains available after a canceled or failed share. */ }
    }
    try { await navigator.clipboard.writeText(url); setNotice("本站歌单链接已复制。"); }
    catch { setNotice("无法复制链接，请从浏览器地址栏复制当前页面地址。"); }
  };

  const openEdit = (trigger: HTMLButtonElement): void => {
    if (!owner || !detail) return;
    editTrigger.current = trigger;
    setEditUser(user);
    setEditName(detail.playlist.name);
    setEditDescription(detail.playlist.description ?? "");
    setEditTags(detail.playlist.tags.join(", "));
    setActionError(null);
    setEditOpen(true);
    window.requestAnimationFrame(() => editNameRef.current?.focus());
  };

  const closeEdit = (): void => {
    if (pendingRef.current) return;
    setEditOpen(false);
    setActionError(null);
    editTrigger.current?.focus({ preventScroll: true });
  };

  const saveEdit = (): void => {
    if (!editVisible || !detail || pendingRef.current) return;
    const name = editName.trim();
    const description = editDescription.trim();
    const tags = editTags.trim() ? editTags.split(",").map((tag) => tag.trim()) : [];
    if (!name || name.length > 40 || description.length > 1000
      || tags.length > 3 || tags.some((tag) => !tag || tag.length > 20)
      || new Set(tags).size !== tags.length) {
      setActionError("名称需 1 至 40 字符，描述最多 1000 字符，标签最多 3 个且各不超过 20 字符。");
      return;
    }
    const updates: PlaylistUpdate[] = [];
    if (name !== detail.playlist.name) updates.push({ field: "name", value: name });
    if (description !== (detail.playlist.description ?? "")) updates.push({ field: "description", value: description });
    if (tags.join(",") !== detail.playlist.tags.join(",")) updates.push({ field: "tags", value: tags });
    if (updates.length === 0) { closeEdit(); return; }
    pendingRef.current = true;
    setPending(true);
    setActionError(null);
    void (async () => {
      let confirmed = 0;
      try {
        for (const update of updates) {
          await updatePlaylist(playlistId, update, createMutationId());
          confirmed += 1;
        }
        setEditOpen(false);
        setNotice("歌单资料已更新。");
        dispatchLibraryChanged();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "歌单编辑未完成。";
        setEditOpen(false);
        setActionError(confirmed > 0
          ? `部分修改已保存，后续操作已停止。${message} 请查看刷新后的歌单。`
          : `${message} 请查看刷新后的歌单，确认状态后再操作。`);
        if (caught instanceof PlaylistClientError && (caught.code === "AUTH_REQUIRED" || caught.code === "SESSION_EXPIRED")) openLogin();
      } finally {
        refresh();
        pendingRef.current = false;
        setPending(false);
      }
    })();
  };

  const publish = (): void => {
    if (!owner || detail?.playlist.visibility !== "private" || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setActionError(null);
    void updatePlaylist(playlistId, { field: "publish" }, createMutationId())
      .then(() => {
        setConfirmation(null);
        setNotice("歌单已公开，可通过本站链接分享。");
        dispatchLibraryChanged();
      })
      .catch((caught: unknown) => {
        setConfirmation(null);
        setActionError(`${caught instanceof Error ? caught.message : "公开歌单未完成。"} 请查看刷新后的状态。`);
        if (caught instanceof PlaylistClientError && (caught.code === "AUTH_REQUIRED" || caught.code === "SESSION_EXPIRED")) openLogin();
      })
      .finally(() => { refresh(); pendingRef.current = false; setPending(false); });
  };

  const closeConfirmation = (): void => {
    if (pendingRef.current) return;
    setConfirmation(null);
    setActionError(null);
    confirmationTrigger.current?.focus({ preventScroll: true });
  };

  const onConfirmationKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") { event.preventDefault(); closeConfirmation(); return; }
    if (event.key !== "Tab") return;
    const focusable = confirmationDialog.current ? focusableElements(confirmationDialog.current) : [];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) { event.preventDefault(); confirmationDialog.current?.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const removeTrack = (trackId: string): void => {
    if (!owner || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setActionError(null);
    void changePlaylistTracks(playlistId, [trackId], "remove", createMutationId())
      .then(() => {
        setConfirmation(null);
        setNotice("歌曲已从歌单移除。");
        refresh();
        dispatchLibraryChanged();
        window.requestAnimationFrame(() => tracksHeading.current?.focus({ preventScroll: true }));
      })
      .catch((caught: unknown) => {
        if (caught instanceof PlaylistClientError && (caught.code === "AUTH_REQUIRED" || caught.code === "SESSION_EXPIRED")) {
          setConfirmation(null);
          openLogin();
        }
        setActionError(caught instanceof Error ? caught.message : "移除歌曲未完成。");
      })
      .finally(() => { pendingRef.current = false; setPending(false); });
  };

  const confirmDelete = (): void => {
    if (!owner || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setActionError(null);
    void deletePlaylist(playlistId, createMutationId())
      .then(() => { dispatchLibraryChanged(); router.push("/library"); })
      .catch((caught: unknown) => {
        if (caught instanceof PlaylistClientError && (caught.code === "AUTH_REQUIRED" || caught.code === "SESSION_EXPIRED")) {
          setConfirmation(null);
          openLogin();
        }
        setActionError(caught instanceof Error ? caught.message : "删除歌单未完成。");
      })
      .finally(() => { pendingRef.current = false; setPending(false); });
  };

  if (!detail && loading) {
    return <div aria-label="正在加载歌单" className={styles.page} role="status"><Skeleton variant="artwork" /><Skeleton variant="line" /><Skeleton variant="line-short" /></div>;
  }

  if (!detail && error) {
    return <div className={styles.page}><StatusView
      action={error.retryable ? { label: "重试", onClick: refresh } : undefined}
      description={error.message}
      title={error.code === "TRACK_UNAVAILABLE" ? "找不到歌单" : error.code === "AUTH_REQUIRED" ? "歌单未公开" : "歌单暂时不可用"}
      tone={error.code === "AUTH_REQUIRED" ? "unavailable" : "error"}
      variant="page"
    /></div>;
  }

  if (!detail) return null;
  const { playlist, tracks } = detail;

  return (
    <main className={styles.page} data-playlist-state={loading ? "refreshing" : "ready"}>
      <Link className={styles.back} href="/library"><ArrowLeft aria-hidden="true" />音乐库</Link>
      <header className={styles.header}>
        <AlbumArtwork alt={`${playlist.name} 封面`} className={styles.artwork} src={playlist.artworkUrl} status={playlist.artworkUrl ? "loaded" : "empty"} variant="tile" />
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>ECHOFORM / PLAYLIST</p>
          <h1 data-page-heading tabIndex={-1}>{playlist.name}</h1>
          <p className={styles.meta}>{playlist.visibility === "private" ? "私密歌单" : "公开歌单"} · {tracks.length} 首歌曲</p>
          {playlist.description ? <p className={styles.description}>{playlist.description}</p> : null}
          <div className={styles.actions}>
            <TextButton onClick={() => { void share(); }} variant="secondary"><Share2 aria-hidden="true" />分享</TextButton>
            {owner ? <>
              <TextButton disabled={pending} onClick={(event) => openEdit(event.currentTarget)} variant="quiet"><Pencil aria-hidden="true" />编辑</TextButton>
              {playlist.visibility === "private" ? <TextButton disabled={pending} onClick={(event) => { confirmationTrigger.current = event.currentTarget; setActionError(null); setConfirmation({ kind: "publish" }); }} variant="quiet">设为公开</TextButton> : null}
              <TextButton onClick={(event) => { confirmationTrigger.current = event.currentTarget; setActionError(null); setConfirmation({ kind: "delete" }); }} variant="danger"><Trash2 aria-hidden="true" />删除</TextButton>
            </> : null}
            {!user && mode === "real" && authStatus === "ready" ? <TextButton onClick={openLogin} variant="quiet">扫码登录后管理</TextButton> : null}
          </div>
          {playlist.tags.length > 0 ? <p className={styles.meta}>标签：{playlist.tags.join(" · ")}</p> : null}
        </div>
      </header>
      {notice ? <p aria-live="polite" className={styles.notice}>{notice}</p> : null}
      {error ? <StatusView action={{ label: "重新加载", onClick: refresh }} description={error.message} title="刷新歌单失败，仍显示上次内容" tone="error" /> : null}
      {actionError && !confirmation ? <p className={styles.actionError} role="alert">{actionError}</p> : null}
      {editVisible ? <section aria-labelledby="playlist-edit-heading" className={styles.editPanel}>
        <h2 id="playlist-edit-heading">编辑歌单</h2>
        <label htmlFor="playlist-edit-name">名称</label>
        <input id="playlist-edit-name" maxLength={40} onChange={(event) => setEditName(event.target.value)} ref={editNameRef} value={editName} />
        <label htmlFor="playlist-edit-description">描述</label>
        <textarea id="playlist-edit-description" maxLength={1000} onChange={(event) => setEditDescription(event.target.value)} rows={3} value={editDescription} />
        <label htmlFor="playlist-edit-tags">标签（最多 3 个，逗号分隔）</label>
        <input id="playlist-edit-tags" onChange={(event) => setEditTags(event.target.value)} value={editTags} />
        <div className={styles.actions}>
          <TextButton disabled={pending} onClick={closeEdit} variant="secondary">取消</TextButton>
          <TextButton loading={pending} onClick={saveEdit}>保存修改</TextButton>
        </div>
      </section> : null}
      <section aria-labelledby="playlist-tracks-heading" className={styles.tracks}>
        <div className={styles.sectionHeading}><h2 id="playlist-tracks-heading" ref={tracksHeading} tabIndex={-1}>曲目</h2><span>{tracks.length} 首</span></div>
        {tracks.length === 0 ? <StatusView title="这个歌单还没有歌曲" description="可以从歌曲页添加音乐。" tone="empty" /> : (
          <div className={styles.trackList}>
            {tracks.map((track) => <div className={styles.trackItem} key={track.id}>
              <TrackRow queue={queue} track={track} />
              <LibraryActionButton entity={track} kind="track" />
              {owner ? <button aria-label={`从歌单移除 ${track.name}`} className={styles.iconAction} disabled={pending} onClick={(event) => { confirmationTrigger.current = event.currentTarget; setActionError(null); setConfirmation({ kind: "remove", trackId: track.id, trackName: track.name }); }} title="从歌单移除" type="button"><X aria-hidden="true" /></button> : null}
            </div>)}
          </div>
        )}
        {owner ? <Link className={styles.addLink} href="/search"><Plus aria-hidden="true" />搜索歌曲并添加</Link> : null}
      </section>
      {confirmation ? <div className={styles.scrim}>
        <div aria-busy={pending || undefined} aria-describedby="playlist-confirm-description" aria-labelledby="playlist-confirm-title" aria-modal="true" className={styles.dialog} onKeyDown={onConfirmationKeyDown} ref={confirmationDialog} role="dialog" tabIndex={-1}>
          <h2 id="playlist-confirm-title">{confirmation.kind === "delete" ? "删除歌单？" : confirmation.kind === "publish" ? "公开歌单？" : `移除 ${confirmation.trackName}？`}</h2>
          <p id="playlist-confirm-description">{confirmation.kind === "delete" ? "这会从网易云账号永久删除该歌单及其曲目关系，无法在本站撤销。" : confirmation.kind === "publish" ? "公开后任何人都可通过链接查看；当前接口无法把它改回私密。" : "这会从网易云账号的当前歌单移除这首歌曲，不会删除歌曲本身。"}</p>
          {actionError ? <p className={styles.actionError} role="alert">{actionError}</p> : null}
          <div className={styles.actions}>
            <TextButton disabled={pending} onClick={closeConfirmation} ref={confirmationCancel} variant="secondary">取消</TextButton>
            <TextButton loading={pending} onClick={() => { if (confirmation.kind === "delete") confirmDelete(); else if (confirmation.kind === "publish") publish(); else removeTrack(confirmation.trackId); }} variant={confirmation.kind === "publish" ? "primary" : "danger"}>{confirmation.kind === "delete" ? "确认删除" : confirmation.kind === "publish" ? "确认公开" : "确认移除"}</TextButton>
          </div>
        </div>
      </div> : null}
    </main>
  );
}
