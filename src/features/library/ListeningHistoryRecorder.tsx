"use client";

import { useEffect, useRef } from "react";

import {
  createListeningHistoryRecorder,
  listeningHistoryScope,
  saveListeningHistoryCapture,
} from "@/lib/listeningHistory";
import { useAuth } from "@/features/auth/AuthProvider";
import { usePlayerRuntime } from "@/features/player/playerContext";

export function ListeningHistoryRecorder() {
  const runtime = usePlayerRuntime();
  const { mode, status, user } = useAuth();
  const recorderRef = useRef(createListeningHistoryRecorder());

  useEffect(() => {
    const recorder = recorderRef.current;
    const observe = (): void => {
      const publicSnapshot = runtime.getPublicSnapshot();
      const timelineSnapshot = runtime.getTimelineSnapshot();
      const capture = recorder.observe({
        currentTimeMs: timelineSnapshot.currentTimeMs,
        currentTrack: publicSnapshot.currentTrack,
        durationMs: timelineSnapshot.durationMs,
        loadRevision: timelineSnapshot.loadRevision,
        playbackStatus: publicSnapshot.playbackStatus,
      }, Date.now());

      if (!capture) {
        return;
      }

      if (status !== "ready") return;
      void saveListeningHistoryCapture(capture, listeningHistoryScope(mode, user?.id ?? null)).catch(() => {
        // Local persistence must never interrupt playback or queue behavior.
      });
    };

    observe();
    const unsubscribeSemantic = runtime.subscribe(observe);
    const unsubscribeTimeline = runtime.subscribeTimeline(observe);

    return () => {
      unsubscribeSemantic();
      unsubscribeTimeline();
      recorder.reset();
    };
  }, [mode, runtime, status, user?.id]);

  return null;
}
