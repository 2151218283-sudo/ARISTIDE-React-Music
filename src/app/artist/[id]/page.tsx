import type { Metadata } from "next";

import { RoutePlaceholder } from "@/components/RoutePlaceholder";

export const metadata: Metadata = { title: "艺术家" };

export default function ArtistPage() {
  return (
    <RoutePlaceholder
      description="沿着艺术家的热门作品、专辑与声音脉络继续探索。"
      eyebrow="ECHOFORM / ARTIST"
      statusDescription="艺术家数据尚未请求；真实作品与完整页面状态将在艺术家任务中实现。"
      title="艺术家"
    />
  );
}
