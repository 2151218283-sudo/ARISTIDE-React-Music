"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AlbumArtwork } from "@/components/AlbumArtwork";
import { Skeleton } from "@/components/Skeleton";
import { StatusView } from "@/components/StatusView";
import { TextButton } from "@/components/TextButton";
import { TrackRow } from "@/components/TrackRow";
import { usePlayerDispatch } from "@/features/player/playerContext";
import type {
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  Track,
} from "@/lib/music/models";
import type { QueueItem } from "@/lib/player";

import { CatalogClientError, requestAlbum, requestArtist } from "./catalogClient";
import styles from "./CatalogDetailPage.module.css";

export type CatalogDetailKind = "album" | "artist";

export interface CatalogDetailPageProps {
  entityId: string;
  kind: CatalogDetailKind;
}

interface CatalogFailure {
  code: string;
  message: string;
  retryable: boolean;
}

const albumRevealSize = 50;
const artistAlbumPageSize = 20;
const pageHeadingFocusStorageKey = "echoform:page-heading-focus";

function queueFor(
  tracks: readonly Track[],
  sourceContext: QueueItem["sourceContext"],
): QueueItem[] {
  return tracks.map((track, index) => ({
    queueItemId: `${sourceContext}:${track.id}:${index}`,
    sourceContext,
    track,
  }));
}

function firstActionableTrack(tracks: readonly Track[]): Track | null {
  return tracks.find((track) => (
    track.availability !== "vip"
    && track.availability !== "copyright"
    && track.availability !== "region"
  )) ?? null;
}

function mergeAlbums(
  existing: readonly AlbumSummary[],
  next: readonly AlbumSummary[],
): AlbumSummary[] {
  const ids = new Set(existing.map((album) => album.id));
  return [...existing, ...next.filter((album) => !ids.has(album.id))];
}

function toFailure(error: unknown): CatalogFailure {
  if (error instanceof CatalogClientError) {
    return error;
  }
  return {
    code: "NETWORK_ERROR",
    message: "无法连接目录服务，请稍后重试。",
    retryable: true,
  };
}

function formatPublishedAt(value: number | null): string | null {
  if (value === null) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" })
      .format(date);
}

function DetailSkeleton() {
  return (
    <div aria-label="正在加载目录详情" className={styles.skeleton} role="status">
      <Skeleton className={styles.skeletonArtwork} variant="artwork" />
      <div className={styles.skeletonCopy}>
        <Skeleton variant="line-short" />
        <Skeleton variant="line" />
        <Skeleton variant="line" />
        <Skeleton variant="button" />
      </div>
      <div className={styles.skeletonRows}>
        <Skeleton variant="block" />
        <Skeleton variant="block" />
        <Skeleton variant="block" />
      </div>
    </div>
  );
}

function AlbumGrid({ albums }: { albums: readonly AlbumSummary[] }) {
  if (albums.length === 0) {
    return <p className={styles.emptyCollection}>暂时没有公开专辑。</p>;
  }

  return (
    <div className={styles.albumGrid}>
      {albums.map((album) => (
        <Link
          aria-label={`查看专辑 ${album.name}`}
          className={styles.albumTile}
          href={`/album/${encodeURIComponent(album.id)}`}
          key={album.id}
        >
          <AlbumArtwork
            alt={`${album.name} 封面`}
            src={album.artworkUrl}
            status={album.artworkUrl ? "loaded" : "empty"}
            variant="tile"
          />
          <span>{album.name}</span>
        </Link>
      ))}
    </div>
  );
}

function AlbumHeader({ detail, onPlayAll }: {
  detail: AlbumDetail;
  onPlayAll: () => void;
}) {
  const publishedAt = formatPublishedAt(detail.album.publishedAt);
  return (
    <header className={styles.header}>
      <AlbumArtwork
        alt={`${detail.album.name} 封面`}
        priority
        src={detail.album.artworkUrl}
        status={detail.album.artworkUrl ? "loaded" : "empty"}
        variant="preview"
      />
      <div className={styles.headerCopy}>
        <p className={styles.eyebrow}>ECHOFORM / ALBUM</p>
        <h1 data-page-heading tabIndex={-1}>{detail.album.name}</h1>
        {detail.album.artists.length > 0 ? (
          <p className={styles.entityLinks}>
            {detail.album.artists.map((artist, index) => (
              <span key={artist.id}>
                {index > 0 ? " / " : null}
                <Link href={`/artist/${encodeURIComponent(artist.id)}`}>{artist.name}</Link>
              </span>
            ))}
          </p>
        ) : null}
        {publishedAt ? <p className={styles.metadata}>{publishedAt}</p> : null}
        {detail.album.description ? <p className={styles.description}>{detail.album.description}</p> : null}
        <TextButton onClick={onPlayAll} variant="primary">播放全部</TextButton>
      </div>
    </header>
  );
}

function ArtistHeader({ detail, onPlayAll }: {
  detail: ArtistDetail;
  onPlayAll: () => void;
}) {
  return (
    <header className={styles.header}>
      <AlbumArtwork
        alt={`${detail.artist.name} 头像`}
        className={styles.artistArtwork}
        priority
        src={detail.artist.avatarUrl}
        status={detail.artist.avatarUrl ? "loaded" : "empty"}
        variant="preview"
      />
      <div className={styles.headerCopy}>
        <p className={styles.eyebrow}>ECHOFORM / ARTIST</p>
        <h1 data-page-heading tabIndex={-1}>{detail.artist.name}</h1>
        {detail.artist.aliases.length > 0 ? (
          <p className={styles.metadata}>{detail.artist.aliases.join(" / ")}</p>
        ) : null}
        {detail.artist.biography ? <p className={styles.description}>{detail.artist.biography}</p> : null}
        <TextButton
          disabled={firstActionableTrack(detail.hotTracks) === null}
          onClick={onPlayAll}
          variant="primary"
        >
          播放热门歌曲
        </TextButton>
      </div>
    </header>
  );
}

export function CatalogDetailPage({ entityId, kind }: CatalogDetailPageProps) {
  const router = useRouter();
  const dispatch = usePlayerDispatch();
  const [albumDetail, setAlbumDetail] = useState<AlbumDetail | null>(null);
  const [artistDetail, setArtistDetail] = useState<ArtistDetail | null>(null);
  const [failure, setFailure] = useState<CatalogFailure | null>(null);
  const [albumPageFailure, setAlbumPageFailure] = useState<CatalogFailure | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAlbums, setIsLoadingAlbums] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const [visibleTrackCount, setVisibleTrackCount] = useState(albumRevealSize);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const currentDetail = kind === "album" ? albumDetail : artistDetail;

  useLayoutEffect(() => {
    headingRef.current = document.querySelector("[data-page-heading]");
    const requestedPath = window.sessionStorage.getItem(pageHeadingFocusStorageKey);
    if (requestedPath === window.location.pathname) {
      window.sessionStorage.removeItem(pageHeadingFocusStorageKey);
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [kind, entityId, currentDetail]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => setShowSkeleton(true), 300);

    void Promise.resolve().then(() => {
      if (controller.signal.aborted) {
        return;
      }
      const request = kind === "album"
        ? requestAlbum(entityId, controller.signal).then((detail) => setAlbumDetail(detail))
        : requestArtist(entityId, { limit: artistAlbumPageSize, offset: 0 }, controller.signal)
          .then((detail) => setArtistDetail(detail));

      return request.catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFailure(toFailure(error));
        }
      }).finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          window.clearTimeout(timer);
        }
      });
    });

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [entityId, kind, retryRevision]);

  const albumQueue = useMemo(
    () => queueFor(albumDetail?.tracks ?? [], "album"),
    [albumDetail],
  );
  const artistQueue = useMemo(
    () => queueFor(artistDetail?.hotTracks ?? [], "manual"),
    [artistDetail],
  );
  const visibleAlbumTracks = albumDetail?.tracks.slice(0, visibleTrackCount) ?? [];

  const playAlbum = (): void => {
    const track = firstActionableTrack(albumDetail?.tracks ?? []);
    if (track) {
      dispatch({ type: "LOAD_TRACK", autoplay: true, queue: albumQueue, track });
    }
  };

  const playArtist = (): void => {
    const track = firstActionableTrack(artistDetail?.hotTracks ?? []);
    if (track) {
      dispatch({ type: "LOAD_TRACK", autoplay: true, queue: artistQueue, track });
    }
  };

  const loadMoreArtistAlbums = async (): Promise<void> => {
    if (!artistDetail || !artistDetail.albums.hasMore || isLoadingAlbums) {
      return;
    }
    setIsLoadingAlbums(true);
    setAlbumPageFailure(null);
    try {
      const next = await requestArtist(entityId, {
        limit: artistAlbumPageSize,
        offset: artistDetail.albums.offset + artistDetail.albums.items.length,
      });
      setArtistDetail((previous) => previous ? {
        ...previous,
        albums: {
          ...next.albums,
          items: mergeAlbums(previous.albums.items, next.albums.items),
          offset: previous.albums.offset,
          limit: previous.albums.limit,
        },
      } : previous);
    } catch (error) {
      setAlbumPageFailure(toFailure(error));
    } finally {
      setIsLoadingAlbums(false);
    }
  };

  const retry = (): void => {
    setIsLoading(true);
    setShowSkeleton(false);
    setFailure(null);
    setAlbumPageFailure(null);
    setVisibleTrackCount(albumRevealSize);
    setRetryRevision((revision) => revision + 1);
  };

  if (!currentDetail && isLoading && !showSkeleton) {
    return <div aria-busy="true" className={styles.pending} />;
  }

  if (!currentDetail && isLoading && showSkeleton) {
    return <DetailSkeleton />;
  }

  if (!currentDetail) {
    const missing = failure?.code === "TRACK_UNAVAILABLE";
    return (
      <div className={styles.statusPage}>
        <StatusView
          action={failure?.retryable ? { label: "重试", onClick: retry } : undefined}
          description={missing
            ? "这个链接指向的公开音乐条目已不存在，或暂时不可读取。"
            : failure?.message ?? "目录详情暂时无法加载。"}
          secondaryAction={{ label: "返回搜索", onClick: () => router.push("/search") }}
          title={missing ? "未找到音乐条目" : "无法加载目录详情"}
          tone={missing ? "empty" : "error"}
          variant="page"
        />
      </div>
    );
  }

  if (kind === "album" && albumDetail) {
    const hasMoreTracks = albumDetail.tracks.length > visibleAlbumTracks.length;
    return (
      <main className={styles.page} data-catalog-kind="album">
        <Link className={styles.backLink} href="/search"><ArrowLeft aria-hidden="true" />返回搜索</Link>
        <AlbumHeader detail={albumDetail} onPlayAll={playAlbum} />
        <section className={styles.section} aria-labelledby="album-tracks-heading">
          <div className={styles.sectionHeader}>
            <h2 id="album-tracks-heading">曲目</h2>
            <span>{albumDetail.tracks.length} 首</span>
          </div>
          {visibleAlbumTracks.length > 0 ? (
            <div className={styles.trackList}>
              {visibleAlbumTracks.map((track) => <TrackRow key={track.id} queue={albumQueue} track={track} />)}
            </div>
          ) : <p className={styles.emptyCollection}>这个专辑暂时没有可列出的曲目。</p>}
          {hasMoreTracks ? (
            <TextButton
              onClick={() => setVisibleTrackCount((count) => count + albumRevealSize)}
              variant="secondary"
            >
              显示更多曲目
            </TextButton>
          ) : null}
        </section>
      </main>
    );
  }

  if (kind === "artist" && artistDetail) {
    return (
      <main className={styles.page} data-catalog-kind="artist">
        <Link className={styles.backLink} href="/search"><ArrowLeft aria-hidden="true" />返回搜索</Link>
        <ArtistHeader detail={artistDetail} onPlayAll={playArtist} />
        <section className={styles.section} aria-labelledby="artist-hot-tracks-heading">
          <div className={styles.sectionHeader}>
            <h2 id="artist-hot-tracks-heading">热门歌曲</h2>
            <span>{artistDetail.hotTracks.length} 首</span>
          </div>
          {artistDetail.hotTracks.length > 0 ? (
            <div className={styles.trackList}>
              {artistDetail.hotTracks.map((track) => <TrackRow key={track.id} queue={artistQueue} track={track} />)}
            </div>
          ) : <p className={styles.emptyCollection}>暂时没有公开热门歌曲。</p>}
        </section>
        <section className={styles.section} aria-labelledby="artist-albums-heading">
          <div className={styles.sectionHeader}>
            <h2 id="artist-albums-heading">专辑</h2>
            <span>{artistDetail.albums.total ?? artistDetail.albums.items.length} 张</span>
          </div>
          <AlbumGrid albums={artistDetail.albums.items} />
          {albumPageFailure ? (
            <StatusView
              action={albumPageFailure.retryable ? { label: "重试", onClick: loadMoreArtistAlbums } : undefined}
              description="已加载的专辑仍可查看。"
              title={albumPageFailure.message}
              tone="error"
              variant="inline"
            />
          ) : null}
          {artistDetail.albums.hasMore ? (
            <TextButton loading={isLoadingAlbums} onClick={loadMoreArtistAlbums} variant="secondary">
              加载更多专辑
            </TextButton>
          ) : null}
        </section>
      </main>
    );
  }

  return null;
}
