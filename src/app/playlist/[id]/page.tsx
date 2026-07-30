import type { Metadata } from "next";

import { RoutePlaceholder } from "@/components/RoutePlaceholder";

export const metadata: Metadata = { title: "歌单" };

export default function PlaylistPage() {
  return (
    <RoutePlaceholder
      description="在连续曲序里浏览、选择并进入一段完整的聆听过程。"
      eyebrow="ECHOFORM / PLAYLIST"
      statusDescription="歌单数据尚未请求；曲目、加载、为空与错误状态将在歌单任务中实现。"
      title="歌单"
    />
  );
}
