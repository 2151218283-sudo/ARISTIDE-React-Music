import type { Track } from "@/lib/music/models";

import styles from "./GalleryTrackMetadata.module.css";

interface GalleryTrackMetadataProps {
  index: number;
  total: number;
  track: Track | null;
}

export function GalleryTrackMetadata({
  index,
  total,
  track,
}: GalleryTrackMetadataProps) {
  if (!track || total === 0) {
    return null;
  }

  return (
    <aside
      aria-label="当前推荐歌曲"
      className={styles.metadata}
      data-track-id={track.id}
    >
      <p className={styles.index}>{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</p>
      <h2 className={styles.title}>{track.name}</h2>
      <p className={styles.artist}>{track.artists.map((artist) => artist.name).join(" / ")}</p>
    </aside>
  );
}
