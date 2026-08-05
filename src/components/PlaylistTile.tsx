import Link from "next/link";

import type { Playlist } from "@/lib/music/models";

import { AlbumArtwork } from "./AlbumArtwork";
import styles from "./PlaylistTile.module.css";

export interface PlaylistTileProps {
  playlist: Playlist;
}

export function PlaylistTile({ playlist }: PlaylistTileProps) {
  return (
    <Link
      aria-label={`查看歌单 ${playlist.name}`}
      className={styles.tile}
      href={`/playlist/${encodeURIComponent(playlist.id)}`}
    >
      <AlbumArtwork
        alt={`${playlist.name} 封面`}
        src={playlist.artworkUrl}
        status={playlist.artworkUrl ? "loaded" : "empty"}
        variant="tile"
      />
      <span className={styles.name}>{playlist.name}</span>
      <span className={styles.meta}>{playlist.trackCount} 首歌曲</span>
    </Link>
  );
}
