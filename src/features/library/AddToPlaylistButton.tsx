"use client";

import { ListPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "@/components/IconButton";
import { useAuth } from "@/features/auth/AuthProvider";
import { requestUserPlaylists } from "@/features/profile/profileClient";
import type { Playlist } from "@/lib/music/models";
import { dispatchLibraryChanged } from "./LibraryMutationProvider";
import { changePlaylistTracks, createMutationId, PlaylistClientError } from "./playlistClient";
import styles from "./AddToPlaylistButton.module.css";

interface Props { trackId: string; trackName: string }

export function AddToPlaylistButton({ trackId, trackName }: Props) {
  const { mode, openLogin, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistUserId, setPlaylistUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const buttonRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (!open || !user || mode !== "real") return;
    const controller = new AbortController();
    const start = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      setPlaylists([]);
      setPlaylistUserId(null);
      void requestUserPlaylists(user.id, controller.signal)
        .then((collection) => {
          if (!controller.signal.aborted) {
            setPlaylists(collection.created);
            setPlaylistUserId(user.id);
          }
        })
        .catch((caught: unknown) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "无法读取歌单。"); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { window.clearTimeout(start); controller.abort(); };
  }, [open, mode, user]);

  const toggle = (): void => {
    setNotice("");
    if (mode !== "real") { setError("演示模式不连接网易云账号歌单。"); return; }
    if (!user) { openLogin(); return; }
    setOpen((value) => !value);
  };

  const add = (playlistId: string): void => {
    if (pendingRef.current || mode !== "real" || !user || playlistUserId !== user.id) return;
    pendingRef.current = true;
    setPendingId(playlistId);
    setError(null);
    void changePlaylistTracks(playlistId, [trackId], "add", createMutationId())
      .then(() => { setNotice("已加入歌单。"); setOpen(false); dispatchLibraryChanged(); buttonRef.current?.querySelector("button")?.focus(); })
      .catch((caught: unknown) => {
        if (caught instanceof PlaylistClientError && (caught.code === "AUTH_REQUIRED" || caught.code === "SESSION_EXPIRED")) openLogin();
        setError(caught instanceof Error ? caught.message : "加入歌单未完成。");
      })
      .finally(() => { pendingRef.current = false; setPendingId(null); });
  };

  const visiblePlaylists = mode === "real" && user?.id === playlistUserId ? playlists : [];

  return <div className={styles.root} ref={buttonRef}>
    <IconButton
      aria-expanded={open}
      icon={<ListPlus aria-hidden="true" />}
      label={`将 ${trackName} 加入歌单`}
      onClick={toggle}
      size="md"
      tooltip="加入歌单"
    />
    {open && mode === "real" && user ? <div className={styles.menu} role="group" aria-label="选择目标歌单">
      <p>加入歌单</p>
      {loading ? <span role="status">正在读取歌单…</span> : null}
      {!loading && !error && visiblePlaylists.length === 0 ? <span>还没有创建的歌单。</span> : null}
      {!loading && !error ? visiblePlaylists.map((playlist) => <button disabled={pendingId !== null} key={playlist.id} onClick={() => add(playlist.id)} type="button">{playlist.name}</button>) : null}
    </div> : null}
    {error ? <span className={styles.message} role="alert">{error}</span> : null}
    {notice ? <span aria-live="polite" className={styles.message}>{notice}</span> : null}
  </div>;
}
