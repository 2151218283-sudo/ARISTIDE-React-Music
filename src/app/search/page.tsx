import type { Metadata } from "next";

import { RoutePlaceholder } from "@/components/RoutePlaceholder";

export const metadata: Metadata = { title: "搜索" };

export default function SearchPage() {
  return (
    <RoutePlaceholder
      description="按歌曲、歌手或专辑关键词寻找音乐。"
      eyebrow="ECHOFORM / SEARCH"
      statusDescription="搜索界面已进入路由骨架，真实检索与结果状态将在后续搜索任务中接入。"
      title="搜索"
    />
  );
}
