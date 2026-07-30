import { useEffect } from "react";
import { createRoot } from "react-dom/client";

import "../../src/app/globals.css";
import shellStyles from "../../src/components/AppShell.module.css";
import { PlayerProvider } from "../../src/features/player/PlayerProvider";
import { usePlayerDispatch } from "../../src/features/player/playerContext";
import type { Track } from "../../src/lib/music/models";
import type { PlayerSourceResolver, QueueItem } from "../../src/lib/player";

import styles from "./playerPreview.module.css";

const previewTrack: Track = {
  id: "player-preview",
  name: "Quiet Form",
  artists: [{ id: "artist-preview", name: "Afterimage", avatarUrl: null }],
  album: { id: "album-preview", name: "Daily Signal", artworkUrl: null },
  durationMs: 214_000,
  artworkUrl: null,
  aliases: [],
  explicit: false,
  availability: "playable",
  privilege: { fee: 0, maxQuality: "standard" },
};

const previewQueue: readonly QueueItem[] = [
  {
    queueItemId: "queue-player-preview",
    sourceContext: "manual",
    track: previewTrack,
  },
];

const pendingSource: PlayerSourceResolver = () => new Promise(() => undefined);

function PlayerPreview() {
  const dispatch = usePlayerDispatch();

  useEffect(() => {
    dispatch({
      type: "LOAD_TRACK",
      track: previewTrack,
      queue: previewQueue,
      autoplay: false,
    });
  }, [dispatch]);

  return (
    <div className={shellStyles.root} data-shell="immersive-fixed" data-preview-root>
      <main className={`${shellStyles.immersiveMain} ${styles.previewMain}`}>
        <div>
          <p className={styles.description}>ECHOFORM / DAILY SIGNAL</p>
          <h1 className={styles.heading}>声音保持流动，界面退到边缘。</h1>
        </div>
        <p className={styles.boundary} data-last-content>
          主内容边界必须始终位于持久播放器上方。
        </p>
      </main>
    </div>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Player preview root is missing.");
}

createRoot(root).render(
  <PlayerProvider sourceResolver={pendingSource}>
    <PlayerPreview />
  </PlayerProvider>,
);
