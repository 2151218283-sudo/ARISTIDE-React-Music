import type { Metadata } from "next";

import { RoutePlaceholder } from "@/components/RoutePlaceholder";

export const metadata: Metadata = { title: "音乐库" };

export default function LibraryPage() {
  return (
    <RoutePlaceholder
      description="集中浏览喜欢的歌曲、收藏的歌单和最近播放。"
      eyebrow="ECHOFORM / LIBRARY"
      statusDescription="音乐库已保留一级入口，登录态与个人收藏数据将在后续任务接入。"
      title="音乐库"
    />
  );
}
