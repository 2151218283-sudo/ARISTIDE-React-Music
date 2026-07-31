import Link from "next/link";

import { AlbumArtwork } from "@/components/AlbumArtwork";
import type { AlbumSummary, ArtistSummary } from "@/lib/music/models";

import styles from "./SearchEntityTile.module.css";

export interface SearchEntityTileProps {
  entity: AlbumSummary | ArtistSummary;
  kind: "album" | "artist";
}

function isAlbum(entity: AlbumSummary | ArtistSummary): entity is AlbumSummary {
  return "artworkUrl" in entity;
}

export function SearchEntityTile({ entity, kind }: SearchEntityTileProps) {
  const artworkUrl = isAlbum(entity) ? entity.artworkUrl : entity.avatarUrl;
  const kindLabel = kind === "album" ? "专辑" : "歌手";

  return (
    <Link
      aria-label={`查看${kindLabel} ${entity.name}`}
      className={styles.tile}
      href={`/${kind}/${encodeURIComponent(entity.id)}`}
    >
      <AlbumArtwork
        alt={`${entity.name}${kindLabel}${kind === "album" ? "封面" : "头像"}`}
        className={kind === "artist" ? styles.artistArtwork : undefined}
        src={artworkUrl}
        status={artworkUrl ? "loaded" : "empty"}
        variant="tile"
      />
      <span className={styles.name}>{entity.name}</span>
      <span className={styles.kind}>{kindLabel}</span>
    </Link>
  );
}
