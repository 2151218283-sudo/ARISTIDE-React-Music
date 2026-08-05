"use client";

import { AlertCircle, LoaderCircle, Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

import { IconButton } from "@/components/IconButton";
import { Skeleton } from "@/components/Skeleton";
import { StatusView } from "@/components/StatusView";
import { TextButton } from "@/components/TextButton";
import { TrackRow as SearchTrackRow } from "@/components/TrackRow";
import { usePlayerSelector } from "@/features/player/playerContext";
import type {
  AlbumSummary,
  ArtistSummary,
  SearchAllResult,
  SearchResponse,
  SearchType,
  Track,
} from "@/lib/music/models";
import type { QueueItem } from "@/lib/player";

import { SearchEntityTile } from "./SearchEntityTile";
import { SearchDiscoveryLanding } from "./SearchDiscoveryLanding";
import {
  AvailabilityClientError,
  requestTrackAvailability,
  type SearchTrackPlayability,
} from "./availabilityClient";
import {
  isSearchType,
  requestSearch,
  SearchClientError,
} from "./searchClient";
import styles from "./SearchExperience.module.css";

const debounceMs = 300;
const slowInitialResultMs = 1_000;
const pageLimit = 20;
const availabilityProbeConcurrency = 3;
const pageHeadingFocusStorageKey = "echoform:page-heading-focus";

const tabs: Array<{ label: string; type: SearchType }> = [
  { label: "综合", type: "all" },
  { label: "歌曲", type: "track" },
  { label: "歌手", type: "artist" },
  { label: "专辑", type: "album" },
];

interface ResultContext {
  query: string;
  response: SearchResponse;
  type: SearchType;
}

interface SearchFailure {
  message: string;
  retryable: boolean;
}

type PaginatedResponse = Exclude<SearchResponse, SearchAllResult>;

function readUrlType(value: string | null): SearchType {
  return isSearchType(value) ? value : "all";
}

function readUrlPlayableOnly(value: string | null): boolean {
  return value === "1";
}

function resultHasNoItems(response: SearchResponse): boolean {
  if (response.type === "all") {
    return response.tracks.items.length === 0
      && response.artists.items.length === 0
      && response.albums.items.length === 0
      && response.partialErrors.length === 0;
  }
  return response.items.length === 0;
}

function partialSectionMessage(type: "track" | "album" | "artist"): string {
  switch (type) {
    case "track":
      return "歌曲结果暂时不可用";
    case "artist":
      return "歌手结果暂时不可用";
    case "album":
      return "专辑结果暂时不可用";
  }
}

function appendUnique<T extends { id: string }>(
  previous: readonly T[],
  next: readonly T[],
): T[] {
  const ids = new Set(previous.map((item) => item.id));
  return [...previous, ...next.filter((item) => !ids.has(item.id))];
}

function responseForPage(
  previous: PaginatedResponse,
  next: SearchResponse,
): PaginatedResponse | null {
  if (next.type === "all" || previous.type !== next.type) {
    return null;
  }

  if (previous.type === "track" && next.type === "track") {
    return {
      ...next,
      items: appendUnique(previous.items, next.items),
      limit: previous.limit,
      offset: previous.offset,
    };
  }
  if (previous.type === "artist" && next.type === "artist") {
    return {
      ...next,
      items: appendUnique(previous.items, next.items),
      limit: previous.limit,
      offset: previous.offset,
    };
  }
  if (previous.type === "album" && next.type === "album") {
    return {
      ...next,
      items: appendUnique(previous.items, next.items),
      limit: previous.limit,
      offset: previous.offset,
    };
  }

  return null;
}

function toQueue(tracks: readonly Track[]): QueueItem[] {
  return tracks.map((track) => ({
    queueItemId: `search:${track.id}`,
    sourceContext: "search",
    track,
  }));
}

function trackPlayability(
  track: Track,
  states: Readonly<Record<string, SearchTrackPlayability>>,
): SearchTrackPlayability {
  const remembered = states[track.id];
  if (remembered) {
    return remembered;
  }
  if (track.availability === "playable") {
    return "verified-playable";
  }
  if (track.availability === "unknown") {
    return "unknown";
  }
  return "unavailable";
}

function searchTracks(response: SearchResponse | null): readonly Track[] {
  if (!response) {
    return [];
  }
  return response.type === "all" ? response.tracks.items : response.type === "track"
    ? response.items
    : [];
}

function visibleSearchTracks(
  tracks: readonly Track[],
  playableOnly: boolean,
  states: Readonly<Record<string, SearchTrackPlayability>>,
): readonly Track[] {
  if (!playableOnly) {
    return tracks;
  }
  return tracks.filter((track) => {
    const state = trackPlayability(track, states);
    return state === "checking" || state === "verified-playable";
  });
}

function resultLabel(type: SearchType): string {
  return tabs.find((tab) => tab.type === type)?.label ?? "搜索";
}

interface SearchSectionProps {
  actionLabel?: string;
  children: ReactNode;
  count: number;
  onViewAll?: () => void;
  title: string;
}

function SearchSection({
  actionLabel,
  children,
  count,
  onViewAll,
  title,
}: SearchSectionProps) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>{title}</h2>
        <span>{count > 0 ? `${count} 项` : "暂无结果"}</span>
        {onViewAll && actionLabel ? (
          <TextButton onClick={onViewAll} variant="quiet">{actionLabel}</TextButton>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function PartialFailure({
  onRetry,
  type,
}: {
  onRetry: () => void;
  type: "track" | "album" | "artist";
}) {
  return (
    <div className={styles.partialFailure} role="alert">
      <AlertCircle aria-hidden="true" />
      <span>{partialSectionMessage(type)}</span>
      <TextButton onClick={onRetry} variant="quiet">重试搜索</TextButton>
    </div>
  );
}

function EntityGrid({
  entities,
  kind,
}: {
  entities: readonly AlbumSummary[] | readonly ArtistSummary[];
  kind: "album" | "artist";
}) {
  return (
    <div className={styles.entityGrid}>
      {entities.map((entity) => (
        <SearchEntityTile entity={entity} key={entity.id} kind={kind} />
      ))}
    </div>
  );
}

function AllSearchResults({
  onTrackPlaybackRequested,
  onRetry,
  onTypeChange,
  playabilities,
  playableOnly,
  response,
}: {
  onTrackPlaybackRequested: (trackId: string) => void;
  onRetry: () => void;
  onTypeChange: (type: SearchType) => void;
  playabilities: Readonly<Record<string, SearchTrackPlayability>>;
  playableOnly: boolean;
  response: SearchAllResult;
}) {
  const failedTypes = new Set(response.partialErrors.map((partial) => partial.type));
  const visibleTracks = visibleSearchTracks(
    response.tracks.items,
    playableOnly,
    playabilities,
  );
  const trackQueue = toQueue(playableOnly
    ? visibleTracks.filter((track) => (
      trackPlayability(track, playabilities) === "verified-playable"
    ))
    : response.tracks.items);

  return (
    <div className={styles.sectionStack}>
      <SearchSection actionLabel="查看全部歌曲" count={visibleTracks.length} onViewAll={() => onTypeChange("track")} title="歌曲">
        {failedTypes.has("track") ? <PartialFailure onRetry={onRetry} type="track" /> : null}
        {visibleTracks.length > 0 ? (
          <div className={styles.trackList}>
            {visibleTracks.map((track) => (
              <SearchTrackRow
                key={track.id}
                onPlaybackRequested={onTrackPlaybackRequested}
                playability={trackPlayability(track, playabilities)}
                queue={trackQueue}
                track={track}
              />
            ))}
          </div>
        ) : !failedTypes.has("track") ? (
          <p className={styles.sectionEmpty}>
            {playableOnly ? "没有已验证可播放的歌曲。" : "没有匹配的歌曲。"}
          </p>
        ) : null}
      </SearchSection>
      <SearchSection actionLabel="查看全部歌手" count={response.artists.items.length} onViewAll={() => onTypeChange("artist")} title="歌手">
        {failedTypes.has("artist") ? <PartialFailure onRetry={onRetry} type="artist" /> : null}
        {response.artists.items.length > 0 ? (
          <EntityGrid entities={response.artists.items} kind="artist" />
        ) : !failedTypes.has("artist") ? <p className={styles.sectionEmpty}>没有匹配的歌手。</p> : null}
      </SearchSection>
      <SearchSection actionLabel="查看全部专辑" count={response.albums.items.length} onViewAll={() => onTypeChange("album")} title="专辑">
        {failedTypes.has("album") ? <PartialFailure onRetry={onRetry} type="album" /> : null}
        {response.albums.items.length > 0 ? (
          <EntityGrid entities={response.albums.items} kind="album" />
        ) : !failedTypes.has("album") ? <p className={styles.sectionEmpty}>没有匹配的专辑。</p> : null}
      </SearchSection>
    </div>
  );
}

function LoadMore({
  hasMore,
  loading,
  onLoadMore,
  onRetry,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  if (!hasMore) {
    return null;
  }

  return (
    <div className={styles.loadMore}>
      <TextButton loading={loading} onClick={onLoadMore} variant="secondary">加载更多</TextButton>
      <TextButton onClick={onRetry} variant="quiet">重新搜索</TextButton>
    </div>
  );
}

function SingleSearchResults({
  isLoadingMore,
  onLoadMore,
  onTrackPlaybackRequested,
  onRetry,
  playabilities,
  playableOnly,
  response,
}: {
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onTrackPlaybackRequested: (trackId: string) => void;
  onRetry: () => void;
  playabilities: Readonly<Record<string, SearchTrackPlayability>>;
  playableOnly: boolean;
  response: PaginatedResponse;
}) {
  if (response.type === "track") {
    const visibleTracks = visibleSearchTracks(response.items, playableOnly, playabilities);
    const queue = toQueue(playableOnly
      ? visibleTracks.filter((track) => (
        trackPlayability(track, playabilities) === "verified-playable"
      ))
      : response.items);
    return (
      <SearchSection count={visibleTracks.length} title="歌曲">
        {visibleTracks.length > 0 ? (
          <div className={styles.trackList}>
            {visibleTracks.map((track) => (
              <SearchTrackRow
                key={track.id}
                onPlaybackRequested={onTrackPlaybackRequested}
                playability={trackPlayability(track, playabilities)}
                queue={queue}
                track={track}
              />
            ))}
          </div>
        ) : (
          <p className={styles.sectionEmpty}>
            {playableOnly ? "没有已验证可播放的歌曲。" : "没有匹配的歌曲。"}
          </p>
        )}
        <LoadMore hasMore={response.hasMore} loading={isLoadingMore} onLoadMore={onLoadMore} onRetry={onRetry} />
      </SearchSection>
    );
  }

  const kind = response.type;
  return (
    <SearchSection count={response.items.length} title={kind === "artist" ? "歌手" : "专辑"}>
      <EntityGrid entities={response.items} kind={kind} />
      <LoadMore hasMore={response.hasMore} loading={isLoadingMore} onLoadMore={onLoadMore} onRetry={onRetry} />
    </SearchSection>
  );
}

function SearchResults({
  isLoadingMore,
  onLoadMore,
  onTrackPlaybackRequested,
  onRetry,
  onTypeChange,
  playabilities,
  playableOnly,
  response,
}: {
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onTrackPlaybackRequested: (trackId: string) => void;
  onRetry: () => void;
  onTypeChange: (type: SearchType) => void;
  playabilities: Readonly<Record<string, SearchTrackPlayability>>;
  playableOnly: boolean;
  response: SearchResponse;
}) {
  if (response.type === "all") {
    return (
      <AllSearchResults
        onRetry={onRetry}
        onTrackPlaybackRequested={onTrackPlaybackRequested}
        onTypeChange={onTypeChange}
        playabilities={playabilities}
        playableOnly={playableOnly}
        response={response}
      />
    );
  }
  return (
    <SingleSearchResults
      isLoadingMore={isLoadingMore}
      onLoadMore={onLoadMore}
      onTrackPlaybackRequested={onTrackPlaybackRequested}
      onRetry={onRetry}
      playabilities={playabilities}
      playableOnly={playableOnly}
      response={response}
    />
  );
}

function SearchLanding({ onFocusInput }: { onFocusInput: () => void }) {
  return <SearchDiscoveryLanding onFocusInput={onFocusInput} />;
}

function ResultSkeleton() {
  return (
    <div aria-label="搜索结果加载中" className={styles.skeleton} role="status">
      <Skeleton variant="line" />
      <Skeleton variant="block" />
      <Skeleton variant="block" />
      <Skeleton variant="block" />
    </div>
  );
}

export function SearchExperience() {
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q")?.trim() ?? "";
  const urlType = readUrlType(searchParams.get("type"));
  const urlPlayableOnly = readUrlPlayableOnly(searchParams.get("playable"));
  const urlStateKey = `${urlQuery}\u0000${urlType}\u0000${urlPlayableOnly}`;
  const [inputValue, setInputValue] = useState(urlQuery);
  const [selectedType, setSelectedType] = useState<SearchType>(urlType);
  const [playableOnly, setPlayableOnly] = useState(urlPlayableOnly);
  const [playabilities, setPlayabilities] = useState<
    Record<string, SearchTrackPlayability>
  >({});
  const [availabilityError, setAvailabilityError] = useState<SearchFailure | null>(null);
  const [availabilityRevision, setAvailabilityRevision] = useState(0);
  const [result, setResult] = useState<ResultContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [showInitialSkeleton, setShowInitialSkeleton] = useState(false);
  const [requestError, setRequestError] = useState<SearchFailure | null>(null);
  const [pageError, setPageError] = useState<SearchFailure | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<ResultContext | null>(null);
  const requestRevisionRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const urlStateRef = useRef(urlStateKey);
  const playableOnlyRef = useRef(playableOnly);
  const playabilitiesRef = useRef(playabilities);
  const playerSnapshot = usePlayerSelector((snapshot) => snapshot);

  const commitResult = useCallback((nextResult: ResultContext | null) => {
    resultRef.current = nextResult;
    setResult(nextResult);
  }, []);

  const updateTrackPlayability = useCallback((
    trackId: string,
    state: SearchTrackPlayability,
  ) => {
    setPlayabilities((previous) => (
      previous[trackId] === state ? previous : { ...previous, [trackId]: state }
    ));
  }, []);

  const writeUrl = useCallback((
    query: string,
    type: SearchType,
    includePlayableOnly: boolean,
    mode: "push" | "replace",
  ) => {
    const normalized = query.trim();
    const params = new URLSearchParams();
    if (normalized) {
      params.set("q", normalized);
      params.set("type", type);
      if (includePlayableOnly) {
        params.set("playable", "1");
      }
    }
    const href = params.size > 0 ? `/search?${params.toString()}` : "/search";
    if (mode === "push") {
      window.history.pushState(null, "", href);
      return;
    }
    window.history.replaceState(null, "", href);
  }, []);

  useEffect(() => {
    if (urlStateRef.current === urlStateKey) {
      return;
    }
    urlStateRef.current = urlStateKey;
    setInputValue(urlQuery);
    setSelectedType(urlType);
    setPlayableOnly(urlPlayableOnly);
  }, [urlPlayableOnly, urlQuery, urlStateKey, urlType]);

  useEffect(() => {
    playableOnlyRef.current = playableOnly;
  }, [playableOnly]);

  useEffect(() => {
    playabilitiesRef.current = playabilities;
  }, [playabilities]);

  useLayoutEffect(() => {
    const requestedPath = window.sessionStorage.getItem(pageHeadingFocusStorageKey);
    let requestedBySameOriginNavigation = false;
    try {
      requestedBySameOriginNavigation = Boolean(document.referrer)
        && new URL(document.referrer).origin === window.location.origin;
    } catch {
      requestedBySameOriginNavigation = false;
    }

    if (
      requestedPath !== window.location.pathname
      && !requestedBySameOriginNavigation
    ) {
      return;
    }

    if (requestedPath === window.location.pathname) {
      window.sessionStorage.removeItem(pageHeadingFocusStorageKey);
    }
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target?.isContentEditable;
      if (event.key !== "/" || isTypingTarget) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const normalizedQuery = inputValue.trim();

  useEffect(() => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    const revision = requestRevisionRef.current + 1;
    requestRevisionRef.current = revision;
    const resetId = window.setTimeout(() => {
      if (requestRevisionRef.current !== revision) {
        return;
      }
      setRequestError(null);
      setPageError(null);
      setIsLoadingMore(false);
      setShowInitialSkeleton(false);
    }, 0);

    if (!normalizedQuery) {
      const clearId = window.setTimeout(() => {
        if (requestRevisionRef.current !== revision) {
          return;
        }
        setIsLoading(false);
        commitResult(null);
        writeUrl("", selectedType, playableOnlyRef.current, "replace");
      }, debounceMs);
      return () => {
        window.clearTimeout(clearId);
        window.clearTimeout(resetId);
      };
    }

    const debounceId = window.setTimeout(() => {
      const controller = new AbortController();
      requestControllerRef.current = controller;
      setIsLoading(true);
      const skeletonId = window.setTimeout(() => {
        if (requestRevisionRef.current === revision && !resultRef.current) {
          setShowInitialSkeleton(true);
        }
      }, slowInitialResultMs - debounceMs);

      writeUrl(normalizedQuery, selectedType, playableOnlyRef.current, "replace");
      void requestSearch({ limit: pageLimit, signal: controller.signal, text: normalizedQuery, type: selectedType })
        .then((response) => {
          if (requestRevisionRef.current !== revision) {
            return;
          }
          commitResult({ query: normalizedQuery, response, type: selectedType });
          setRequestError(null);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || requestRevisionRef.current !== revision) {
            return;
          }
          const failure = error instanceof SearchClientError
            ? error
            : new SearchClientError("NETWORK_ERROR", "搜索请求未能完成，请稍后重试。", true);
          setRequestError({ message: failure.message, retryable: failure.retryable });
        })
        .finally(() => {
          window.clearTimeout(skeletonId);
          if (requestRevisionRef.current === revision) {
            setIsLoading(false);
            setShowInitialSkeleton(false);
          }
        });
    }, debounceMs);

    return () => {
      window.clearTimeout(debounceId);
      window.clearTimeout(resetId);
      requestControllerRef.current?.abort();
    };
  }, [commitResult, normalizedQuery, retryRevision, selectedType, writeUrl]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setInputValue(event.target.value);
  };

  const handleTypeChange = (type: SearchType): void => {
    if (type === selectedType) {
      return;
    }
    setSelectedType(type);
    writeUrl(inputValue, type, playableOnly, "push");
  };

  const handlePlayableOnlyChange = (checked: boolean): void => {
    setPlayableOnly(checked);
    setAvailabilityError(null);
    writeUrl(inputValue, selectedType, checked, "push");
  };

  const handleTrackPlaybackRequested = (trackId: string): void => {
    updateTrackPlayability(trackId, "checking");
  };

  const handleRetry = (): void => {
    if (!normalizedQuery) {
      inputRef.current?.focus();
      return;
    }
    setRetryRevision((revision) => revision + 1);
  };

  const handleLoadMore = async (): Promise<void> => {
    const currentResult = resultRef.current;
    if (!currentResult || currentResult.response.type === "all" || isLoadingMore) {
      return;
    }
    const response = currentResult.response;
    if (!response.hasMore) {
      return;
    }

    setPageError(null);
    setIsLoadingMore(true);
    try {
      const next = await requestSearch({
        limit: pageLimit,
        offset: response.offset + response.items.length,
        text: currentResult.query,
        type: currentResult.type,
      });
      if (resultRef.current !== currentResult) {
        return;
      }
      const merged = responseForPage(response, next);
      if (!merged) {
        throw new SearchClientError("UPSTREAM_UNAVAILABLE", "搜索结果类型不一致，请重试。", true);
      }
      commitResult({ ...currentResult, response: merged });
    } catch (error) {
      const failure = error instanceof SearchClientError
        ? error
        : new SearchClientError("NETWORK_ERROR", "无法加载更多结果，请稍后重试。", true);
      setPageError({ message: failure.message, retryable: failure.retryable });
    } finally {
      setIsLoadingMore(false);
    }
  };

  const displayIsStale = result !== null && (
    result.query !== normalizedQuery || result.type !== selectedType
  );
  const visibleResult = result?.response ?? null;
  const visibleTracks = useMemo(
    () => searchTracks(visibleResult),
    [visibleResult],
  );
  const availabilityScopeKey = result
    ? `${result.query}\u0000${result.type}\u0000${visibleTracks.map((track) => track.id).join(",")}`
    : "";

  useEffect(() => {
    const currentTrack = playerSnapshot.currentTrack;
    if (!currentTrack || !visibleTracks.some((track) => track.id === currentTrack.id)) {
      return;
    }

    let nextState: SearchTrackPlayability | null = null;
    if (playerSnapshot.playbackStatus === "loading") {
      nextState = "checking";
    } else if (playerSnapshot.hasSource) {
      nextState = "verified-playable";
    } else if (
      playerSnapshot.playbackStatus === "error"
      && (
        playerSnapshot.error?.code === "TRACK_UNAVAILABLE"
        || playerSnapshot.error?.code === "VIP_REQUIRED"
        || playerSnapshot.error?.code === "REGION_RESTRICTED"
      )
    ) {
      nextState = "unavailable";
    }

    if (!nextState) {
      return;
    }

    const updateId = window.setTimeout(() => {
      updateTrackPlayability(currentTrack.id, nextState);
    }, 0);
    return () => window.clearTimeout(updateId);
  }, [playerSnapshot, updateTrackPlayability, visibleTracks]);

  useEffect(() => {
    if (!playableOnly || displayIsStale || visibleTracks.length === 0) {
      return;
    }

    const candidates = visibleTracks.filter((track) => (
      trackPlayability(track, playabilitiesRef.current) === "unknown"
    ));
    if (candidates.length === 0) {
      return;
    }

    const controller = new AbortController();
    setAvailabilityError(null);
    setPlayabilities((previous) => {
      const next = { ...previous };
      for (const track of candidates) {
        next[track.id] = "checking";
      }
      return next;
    });

    let nextIndex = 0;
    const checkNext = async (): Promise<void> => {
      while (!controller.signal.aborted && nextIndex < candidates.length) {
        const track = candidates[nextIndex];
        nextIndex += 1;
        try {
          const state = await requestTrackAvailability(track.id, controller.signal);
          if (!controller.signal.aborted) {
            updateTrackPlayability(track.id, state);
          }
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }
          updateTrackPlayability(track.id, "unknown");
          const failure = error instanceof AvailabilityClientError
            ? error
            : new AvailabilityClientError("无法验证歌曲是否可播放，请稍后重试。", true);
          setAvailabilityError({
            message: failure.message,
            retryable: failure.retryable,
          });
        }
      }
    };

    void Promise.all(
      Array.from(
        { length: Math.min(availabilityProbeConcurrency, candidates.length) },
        () => checkNext(),
      ),
    );
    return () => controller.abort();
  }, [availabilityRevision, availabilityScopeKey, displayIsStale, playableOnly, updateTrackPlayability, visibleTracks]);

  const handleAvailabilityRetry = (): void => {
    setPlayabilities((previous) => {
      const next = { ...previous };
      for (const track of visibleTracks) {
        if (trackPlayability(track, previous) === "unknown") {
          next[track.id] = "unknown";
        }
      }
      return next;
    });
    setAvailabilityError(null);
    setAvailabilityRevision((revision) => revision + 1);
  };

  const checkingAvailabilityCount = visibleTracks.filter((track) => (
    trackPlayability(track, playabilities) === "checking"
  )).length;
  const isEmpty = visibleResult !== null && !displayIsStale && resultHasNoItems(visibleResult);
  const state = !normalizedQuery
    ? "idle"
    : isLoading
      ? "loading"
      : requestError && !visibleResult
        ? "error"
        : isEmpty
          ? "empty"
          : "ready";
  const activeResultLabel = result ? resultLabel(result.type) : resultLabel(selectedType);
  const tabPanelId = `search-panel-${selectedType}`;

  const resultsSummary = useMemo(() => {
    if (!visibleResult || displayIsStale) {
      return null;
    }
    if (visibleResult.type === "all") {
      const total = visibleResult.tracks.items.length
        + visibleResult.artists.items.length
        + visibleResult.albums.items.length;
      return `找到 ${total} 项综合结果`;
    }
    return visibleResult.total === null
      ? `已显示 ${visibleResult.items.length} 项${activeResultLabel}结果`
      : `找到 ${visibleResult.total} 项${activeResultLabel}结果`;
  }, [activeResultLabel, displayIsStale, visibleResult]);

  return (
    <div className={styles.page} data-search-state={state}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>ECHOFORM / SEARCH</p>
        <h1 data-page-heading ref={headingRef} tabIndex={-1}>搜索</h1>
        <form className={styles.searchForm} onSubmit={(event) => event.preventDefault()} role="search">
          <label className={styles.inputLabel} htmlFor="music-search">搜索歌曲、歌手或专辑</label>
          <div className={styles.inputFrame} data-loading={isLoading || undefined}>
            <Search aria-hidden="true" className={styles.searchIcon} strokeWidth={1.7} />
            <input autoComplete="off" id="music-search" onChange={handleInputChange} placeholder="输入关键词" ref={inputRef} spellCheck={false} type="search" value={inputValue} />
            {isLoading ? <LoaderCircle aria-label="正在更新搜索结果" className={styles.progress} /> : null}
            {inputValue ? (
              <IconButton icon={<X />} label="清除搜索词" onClick={() => setInputValue("")} size="sm" tooltip="清除" />
            ) : null}
          </div>
        </form>
      </header>

      {normalizedQuery ? (
        <div className={styles.resultsArea}>
          <div aria-label="搜索分类" className={styles.tabs} role="tablist">
            {tabs.map((tab) => (
              <button aria-controls={tabPanelId} aria-selected={selectedType === tab.type} id={`search-tab-${tab.type}`} key={tab.type} onClick={() => handleTypeChange(tab.type)} role="tab" type="button">
                {tab.label}
              </button>
            ))}
          </div>
          <label className={styles.availabilityFilter}>
            <input
              checked={playableOnly}
              onChange={(event) => handlePlayableOnlyChange(event.target.checked)}
              type="checkbox"
            />
            <span>仅看可播放</span>
          </label>
          <div aria-labelledby={`search-tab-${selectedType}`} className={styles.resultsPanel} id={tabPanelId} role="tabpanel">
            <div aria-live="polite" className={styles.resultHeading}>
              <span>{displayIsStale ? `显示“${result?.query}”的先前结果` : `${activeResultLabel}结果`}</span>
              {isLoading ? <span>正在更新</span> : resultsSummary ? <span>{resultsSummary}</span> : null}
            </div>
            {playableOnly && checkingAvailabilityCount > 0 ? (
              <p aria-live="polite" className={styles.availabilityProgress} role="status">
                正在检查 {checkingAvailabilityCount} 首歌曲是否可播放
              </p>
            ) : null}
            {availabilityError ? (
              <StatusView
                action={availabilityError.retryable
                  ? { label: "重试检查", onClick: handleAvailabilityRetry }
                  : undefined}
                description="你仍可关闭筛选查看所有搜索结果。"
                title={availabilityError.message}
                tone="error"
                variant="inline"
              />
            ) : null}
            {requestError ? (
              <StatusView
                action={requestError.retryable ? { label: "重试", onClick: handleRetry } : undefined}
                description={visibleResult ? "已保留上一次有效结果。" : requestError.message}
                title={visibleResult ? `无法更新搜索结果：${requestError.message}` : "搜索服务暂时不可用"}
                tone="error"
                variant="inline"
              />
            ) : null}
            {pageError ? (
              <StatusView action={pageError.retryable ? { label: "重试", onClick: handleLoadMore } : undefined} description="已加载的结果仍可使用。" title={pageError.message} tone="error" variant="inline" />
            ) : null}
            {showInitialSkeleton ? <ResultSkeleton /> : null}
            {isEmpty ? (
              <StatusView action={{ label: "修改关键词", onClick: () => inputRef.current?.focus() }} description={`没有找到与“${normalizedQuery}”相关的${activeResultLabel}。`} title="没有找到相关音乐" tone="empty" variant="page" />
            ) : visibleResult ? (
              <SearchResults
                isLoadingMore={isLoadingMore}
                onLoadMore={handleLoadMore}
                onRetry={handleRetry}
                onTrackPlaybackRequested={handleTrackPlaybackRequested}
                onTypeChange={handleTypeChange}
                playabilities={playabilities}
                playableOnly={playableOnly}
                response={visibleResult}
              />
            ) : !requestError && !showInitialSkeleton ? <p className={styles.waiting}>准备搜索“{normalizedQuery}”</p> : null}
          </div>
        </div>
      ) : <SearchLanding onFocusInput={() => inputRef.current?.focus()} />}
    </div>
  );
}
