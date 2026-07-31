import type { Metadata } from "next";

import { TrackPlayerPage } from "@/features/player/TrackPlayerPage";

export const metadata: Metadata = { title: "完整播放页" };

interface TrackPageProps {
  params: Promise<{ id: string }>;
}

export default async function TrackPage({ params }: TrackPageProps) {
  const { id } = await params;
  return <TrackPlayerPage trackId={id} />;
}
