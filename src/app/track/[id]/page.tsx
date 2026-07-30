import type { Metadata } from "next";

import { RoutePlaceholder } from "@/components/RoutePlaceholder";

export const metadata: Metadata = { title: "完整播放页" };

export default function TrackPage() {
  return (
    <RoutePlaceholder
      description="围绕封面、歌词和声音建立完整的沉浸式播放空间。"
      eyebrow="ECHOFORM / NOW PLAYING"
      statusDescription="当前只建立完整播放页边界，播放器状态机、音频控制与歌词将在后续任务接入。"
      title="完整播放页"
    />
  );
}
