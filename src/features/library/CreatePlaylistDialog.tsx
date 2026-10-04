"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { TextButton } from "@/components/TextButton";
import { useAuth } from "@/features/auth/AuthProvider";
import type { Playlist } from "@/lib/music/models";
import { createMutationId, createPlaylist, PlaylistClientError } from "./playlistClient";
import styles from "./CreatePlaylistDialog.module.css";

interface Props {
  open: boolean;
  onClose(): void;
  onCreated(playlist: Playlist): void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

export function CreatePlaylistDialog({ open, onClose, onCreated, triggerRef }: Props) {
  const { openLogin } = useAuth();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  const close = (): void => {
    if (busy.current) return;
    onClose();
    setError(null);
    setName("");
    setVisibility("public");
    triggerRef.current?.focus();
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (busy.current) return;
    const normalized = name.trim();
    if (!normalized || normalized.length > 40) {
      setError("歌单名称需要 1 至 40 个字符。");
      nameRef.current?.focus();
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    void createPlaylist(normalized, visibility, createMutationId())
      .then((playlist) => { busy.current = false; onCreated(playlist); close(); })
      .catch((caught: unknown) => {
        if (caught instanceof PlaylistClientError && (caught.code === "AUTH_REQUIRED" || caught.code === "SESSION_EXPIRED")) openLogin();
        setError(caught instanceof Error ? caught.message : "创建歌单未完成，请重试。");
      })
      .finally(() => { busy.current = false; setPending(false); });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key !== "Tab") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])"));
    const first = items[0];
    const last = items.at(-1);
    if (first && last && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (first && last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  if (!open) return null;
  return <div className={styles.scrim}>
    <div aria-labelledby="create-playlist-title" aria-modal="true" className={styles.dialog} onKeyDown={onKeyDown} role="dialog">
      <h2 id="create-playlist-title">创建歌单</h2>
      <form className={styles.form} onSubmit={submit}>
        <label htmlFor="playlist-name">名称</label>
        <input autoComplete="off" id="playlist-name" maxLength={40} onChange={(event) => setName(event.target.value)} ref={nameRef} required value={name} />
        <fieldset>
          <legend>公开状态</legend>
          <label><input checked={visibility === "public"} name="playlist-visibility" onChange={() => setVisibility("public")} type="radio" />公开</label>
          <label><input checked={visibility === "private"} name="playlist-visibility" onChange={() => setVisibility("private")} type="radio" />私密</label>
        </fieldset>
        <p className={styles.hint}>私密歌单仅当前账号可查看。</p>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.actions}>
          <TextButton disabled={pending} onClick={close} variant="secondary">取消</TextButton>
          <TextButton loading={pending} type="submit">创建</TextButton>
        </div>
      </form>
    </div>
  </div>;
}
