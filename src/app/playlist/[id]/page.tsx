import type { Metadata } from "next";

import { PlaylistExperience } from "@/features/library/PlaylistExperience";

export const metadata: Metadata = { title: "歌单" };

export default async function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlaylistExperience playlistId={id} />;
}
