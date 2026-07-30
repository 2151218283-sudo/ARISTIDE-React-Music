import type { Metadata } from "next";

import { RoutePlaceholder } from "@/components/RoutePlaceholder";

export const metadata: Metadata = { title: "专辑" };

export default function AlbumPage() {
  return (
    <RoutePlaceholder
      description="从一张专辑的完整曲序、创作者与发行信息继续聆听。"
      eyebrow="ECHOFORM / ALBUM"
      statusDescription="专辑数据尚未请求；真实内容、加载、为空与错误状态将在专辑任务中实现。"
      title="专辑"
    />
  );
}
