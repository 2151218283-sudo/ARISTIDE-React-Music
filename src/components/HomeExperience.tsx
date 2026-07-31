"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DailyRecommendationStatus } from "@/features/discovery/DailyRecommendationStatus";
import {
  DailyRecommendationsProvider,
  useDailyRecommendationsState,
} from "@/features/discovery/DailyRecommendationsProvider";
import { GalleryTrackMetadata } from "@/features/discovery/GalleryTrackMetadata";
import {
  TrackPreviewStage,
  type TrackPreviewPhase,
} from "@/features/discovery/TrackPreviewStage";
import type { Track } from "@/lib/music/models";

import { AboutPanel } from "./AboutPanel";
import {
  FilmstripGallery,
  type FilmstripGalleryHandle,
  type FilmstripRenderer,
} from "./FilmstripGallery";

const emptyTracks: Track[] = [];
const galleryReturnTrackStorageKey = "echoform:gallery-return-track";

interface HomeExperienceProps {
  initialAbout?: boolean;
}

interface PreviewState {
  phase: TrackPreviewPhase;
  revision: number;
  track: Track | null;
}

export function HomeExperience({ initialAbout = false }: HomeExperienceProps) {
  return (
    <DailyRecommendationsProvider>
      <HomeExperienceContent initialAbout={initialAbout} />
    </DailyRecommendationsProvider>
  );
}

function HomeExperienceContent({ initialAbout }: HomeExperienceProps) {
  const [isAbout, setIsAbout] = useState(initialAbout ?? false);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [galleryRenderer, setGalleryRenderer] = useState<FilmstripRenderer>("canvas");
  const [restoreTrackId, setRestoreTrackId] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({
    phase: "hidden",
    revision: 0,
    track: null,
  });
  const galleryRef = useRef<FilmstripGalleryHandle>(null);
  const recommendations = useDailyRecommendationsState();
  const tracks = recommendations.data?.tracks ?? emptyTracks;

  const selectedTrack = useMemo(
    () => tracks.find((track) => track.id === currentTrackId) ?? tracks[0] ?? null,
    [currentTrackId, tracks],
  );
  const selectedTrackIndex = selectedTrack
    ? tracks.findIndex((track) => track.id === selectedTrack.id)
    : 0;

  const closeAbout = useCallback(() => {
    setIsAbout(false);

    if (window.location.pathname !== "/") {
      window.history.pushState({ page: "home" }, "", "/");
    }
  }, []);

  const setCurrentTrack = useCallback((track: Track) => {
    setCurrentTrackId(track.id);
  }, []);

  const openPreview = useCallback((track: Track) => {
    setCurrentTrackId(track.id);
    setPreview((current) => ({
      phase: "entering",
      revision: current.revision + 1,
      track,
    }));
  }, []);

  const closePreview = useCallback(() => {
    setPreview((current) => {
      if (current.phase === "hidden" || current.phase === "exiting") {
        return current;
      }

      return {
        ...current,
        phase: "exiting",
        revision: current.revision + 1,
      };
    });
  }, []);

  const rememberGalleryReturn = useCallback((track: Track) => {
    window.sessionStorage.setItem(galleryReturnTrackStorageKey, track.id);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setIsAbout(window.location.pathname === "/about");
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (tracks.length === 0) {
      return;
    }

    const returnTrackId = window.sessionStorage.getItem(galleryReturnTrackStorageKey);
    if (!returnTrackId) {
      return;
    }

    const returnTrack = tracks.find((track) => track.id === returnTrackId);
    if (!returnTrack) {
      window.sessionStorage.removeItem(galleryReturnTrackStorageKey);
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        window.sessionStorage.removeItem(galleryReturnTrackStorageKey);
        setCurrentTrackId(returnTrack.id);
        setRestoreTrackId(returnTrack.id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tracks]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (preview.phase === "entering" || preview.phase === "visible") {
        event.preventDefault();
        closePreview();
      } else if (isAbout) {
        closeAbout();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeAbout, closePreview, isAbout, preview.phase]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (preview.phase !== "entering" && preview.phase !== "exiting") {
      return;
    }

    const phase = preview.phase;
    const duration = reducedMotion ? 16 : phase === "entering" ? 1100 : 500;
    const timer = window.setTimeout(() => {
      setPreview((current) => {
        if (current.revision !== preview.revision || current.phase !== phase) {
          return current;
        }

        if (phase === "entering") {
          return { ...current, phase: "visible" };
        }

        window.queueMicrotask(() => galleryRef.current?.focus());
        return {
          phase: "hidden",
          revision: current.revision,
          track: null,
        };
      });
    }, duration);

    return () => window.clearTimeout(timer);
  }, [preview.phase, preview.revision, reducedMotion]);

  useEffect(() => {
    if (preview.phase !== "entering" && preview.phase !== "visible") {
      return;
    }

    const handlePreviewWheel = (event: WheelEvent) => {
      if (event.deltaX === 0 && event.deltaY === 0 && event.deltaZ === 0) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      closePreview();
    };

    window.addEventListener("wheel", handlePreviewWheel, {
      capture: true,
      passive: false,
    });
    return () => window.removeEventListener("wheel", handlePreviewWheel, true);
  }, [closePreview, preview.phase]);

  const previewTrack = preview.track
    ? tracks.find((track) => track.id === preview.track?.id) ?? preview.track
    : null;
  const previewIndex = previewTrack
    ? tracks.findIndex((track) => track.id === previewTrack.id)
    : -1;
  const previewOpen = preview.phase !== "hidden" && previewTrack !== null;

  return (
    <>
      <FilmstripGallery
        isInteractive={!isAbout && !previewOpen}
        isLoading={recommendations.status === "loading"}
        onCurrentTrackChange={setCurrentTrack}
        onRendererChange={setGalleryRenderer}
        onSelect={openPreview}
        previewPhase={preview.phase}
        previewTrackId={previewTrack?.id ?? null}
        ref={galleryRef}
        restoreTrackId={restoreTrackId}
        selectedTrackId={currentTrackId}
        tracks={tracks}
      />
      {!previewOpen ? (
        <GalleryTrackMetadata
          index={Math.max(selectedTrackIndex, 0)}
          total={tracks.length}
          track={selectedTrack}
        />
      ) : null}
      {previewOpen && previewTrack ? (
        <TrackPreviewStage
          index={Math.max(previewIndex, 0)}
          onClose={closePreview}
          onExplore={rememberGalleryReturn}
          phase={preview.phase === "hidden" ? "entering" : preview.phase}
          showDomArtwork={galleryRenderer === "fallback"}
          total={tracks.length}
          track={previewTrack}
          tracks={tracks}
        />
      ) : null}
      {!previewOpen ? <DailyRecommendationStatus /> : null}
      <AboutPanel isOpen={isAbout} />
    </>
  );
}
