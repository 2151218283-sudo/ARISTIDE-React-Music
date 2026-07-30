"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DailyRecommendationStatus } from "@/features/discovery/DailyRecommendationStatus";
import {
  DailyRecommendationsProvider,
  useDailyRecommendationsState,
} from "@/features/discovery/DailyRecommendationsProvider";
import { GalleryTrackMetadata } from "@/features/discovery/GalleryTrackMetadata";
import type { Track } from "@/lib/music/models";

import { AboutPanel } from "./AboutPanel";
import { FilmstripGallery } from "./FilmstripGallery";

const emptyTracks: Track[] = [];

interface HomeExperienceProps {
  initialAbout?: boolean;
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
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const recommendations = useDailyRecommendationsState();
  const tracks = recommendations.data?.tracks ?? emptyTracks;

  const selectedTrack = useMemo(
    () => tracks.find((track) => track.id === selectedTrackId) ?? tracks[0] ?? null,
    [selectedTrackId, tracks],
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

  const selectTrack = useCallback((track: Track) => {
    setSelectedTrackId(track.id);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setIsAbout(window.location.pathname === "/about");
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isAbout) {
        closeAbout();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeAbout, isAbout]);

  return (
    <>
      <FilmstripGallery
        isInteractive={!isAbout}
        isLoading={recommendations.status === "loading"}
        onCurrentTrackChange={selectTrack}
        onSelect={selectTrack}
        selectedTrackId={selectedTrackId}
        tracks={tracks}
      />
      <GalleryTrackMetadata
        index={Math.max(selectedTrackIndex, 0)}
        total={tracks.length}
        track={selectedTrack}
      />
      <DailyRecommendationStatus />
      <AboutPanel isOpen={isAbout} />
    </>
  );
}
