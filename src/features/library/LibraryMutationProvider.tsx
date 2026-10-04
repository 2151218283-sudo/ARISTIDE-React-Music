"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/features/auth/AuthProvider";
import type { AlbumSummary, Track } from "@/lib/music/models";

import {
  LibraryClientError,
  requestAlbumCollection,
  requestLikedTracks,
  requestSavedAlbums,
  requestTrackLike,
} from "./libraryClient";

export const libraryChangedEventName = "echoform:library-changed";

export type LibraryCollectionStatus = "idle" | "loading" | "ready" | "error";

interface LibraryMutationContextValue {
  albums: AlbumSummary[];
  error: LibraryClientError | null;
  loading: boolean;
  likedTracks: Track[];
  refresh(): Promise<void>;
  setAlbumCollected(album: AlbumSummary, collected: boolean): Promise<void>;
  setTrackLiked(track: Track, liked: boolean): Promise<void>;
  status: LibraryCollectionStatus;
  isAlbumCollected(albumId: string): boolean | null;
  isTrackLiked(trackId: string): boolean | null;
}

const LibraryMutationContext = createContext<LibraryMutationContextValue | null>(null);

const fallbackLibraryMutationContext: LibraryMutationContextValue = {
  albums: [],
  error: null,
  loading: false,
  likedTracks: [],
  refresh: async () => {},
  setAlbumCollected: async () => {
    throw new LibraryClientError("AUTH_REQUIRED", "请先完成扫码登录。", false);
  },
  setTrackLiked: async () => {
    throw new LibraryClientError("AUTH_REQUIRED", "请先完成扫码登录。", false);
  },
  status: "ready",
  isAlbumCollected: () => false,
  isTrackLiked: () => false,
};

function mutationId(): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.randomUUID) {
    return cryptoObject.randomUUID().replaceAll("-", "");
  }
  return `echoform-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function dispatchLibraryChanged(): void {
  window.dispatchEvent(new CustomEvent(libraryChangedEventName));
}

export function LibraryMutationProvider({ children }: { children: ReactNode }) {
  const { mode, openLogin, status: authStatus, user } = useAuth();
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [status, setStatus] = useState<LibraryCollectionStatus>("idle");
  const [error, setError] = useState<LibraryClientError | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (authStatus !== "ready" || (mode === "real" && !user)) {
      setLikedTracks([]);
      setAlbums([]);
      setStatus("ready");
      setError(null);
      return;
    }

    setStatus("loading");
    setError(null);
    try {
      const [likes, savedAlbums] = await Promise.all([
        requestLikedTracks(),
        requestSavedAlbums(),
      ]);
      setLikedTracks(likes.items);
      setAlbums(savedAlbums.items);
      setStatus("ready");
    } catch (caught) {
      const nextError = caught instanceof LibraryClientError
        ? caught
        : new LibraryClientError("UPSTREAM_UNAVAILABLE", "音乐库暂时不可用，请稍后重试。", true);
      setStatus("error");
      setError(nextError);
    }
  }, [authStatus, mode, user]);

  useEffect(() => {
    if (authStatus !== "ready") {
      return;
    }
    const refreshId = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(refreshId);
  }, [authStatus, refresh]);

  const setTrackLiked = useCallback(async (track: Track, liked: boolean): Promise<void> => {
    if (authStatus !== "ready" || (mode === "real" && !user)) {
      openLogin();
      throw new LibraryClientError("AUTH_REQUIRED", "请先完成扫码登录。", false);
    }
    let result;
    try {
      result = await requestTrackLike(track.id, liked, mutationId());
    } catch (caught) {
      if (caught instanceof LibraryClientError
        && (caught.code === "AUTH_REQUIRED" || caught.code === "SESSION_EXPIRED")) {
        openLogin();
      }
      throw caught;
    }
    if (result.active !== liked) {
      throw new LibraryClientError("UPSTREAM_UNAVAILABLE", "音乐库状态未能确认。", true);
    }
    setLikedTracks((previous) => liked
      ? previous.some((item) => item.id === track.id) ? previous : [track, ...previous]
      : previous.filter((item) => item.id !== track.id));
    dispatchLibraryChanged();
  }, [authStatus, mode, openLogin, user]);

  const setAlbumCollected = useCallback(async (
    album: AlbumSummary,
    collected: boolean,
  ): Promise<void> => {
    if (authStatus !== "ready" || (mode === "real" && !user)) {
      openLogin();
      throw new LibraryClientError("AUTH_REQUIRED", "请先完成扫码登录。", false);
    }
    let result;
    try {
      result = await requestAlbumCollection(album.id, collected, mutationId());
    } catch (caught) {
      if (caught instanceof LibraryClientError
        && (caught.code === "AUTH_REQUIRED" || caught.code === "SESSION_EXPIRED")) {
        openLogin();
      }
      throw caught;
    }
    if (result.active !== collected) {
      throw new LibraryClientError("UPSTREAM_UNAVAILABLE", "音乐库状态未能确认。", true);
    }
    setAlbums((previous) => collected
      ? previous.some((item) => item.id === album.id) ? previous : [album, ...previous]
      : previous.filter((item) => item.id !== album.id));
    dispatchLibraryChanged();
  }, [authStatus, mode, openLogin, user]);

  const value = useMemo<LibraryMutationContextValue>(() => {
    const likedIds = new Set(likedTracks.map((track) => track.id));
    const albumIds = new Set(albums.map((album) => album.id));
    return {
      albums,
      error,
      loading: status === "loading",
      likedTracks,
      refresh,
      setAlbumCollected,
      setTrackLiked,
      status,
      isAlbumCollected: (id) => status === "ready" ? albumIds.has(id) : null,
      isTrackLiked: (id) => status === "ready" ? likedIds.has(id) : null,
    };
  }, [albums, error, likedTracks, refresh, setAlbumCollected, setTrackLiked, status]);

  return (
    <LibraryMutationContext.Provider value={value}>
      {children}
    </LibraryMutationContext.Provider>
  );
}

export function useLibraryMutations(): LibraryMutationContextValue {
  const context = useContext(LibraryMutationContext);
  return context ?? fallbackLibraryMutationContext;
}
