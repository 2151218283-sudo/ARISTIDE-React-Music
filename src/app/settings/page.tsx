import type { Metadata } from "next";

import { RoutePlaceholder } from "@/components/RoutePlaceholder";

export const metadata: Metadata = { title: "设置" };

export default function SettingsPage() {
  return (
    <RoutePlaceholder
      description="管理账号入口、播放偏好、显示方式与本地应用信息。"
      eyebrow="ECHOFORM / SETTINGS"
      statusDescription="当前账号图标只进入设置骨架，不会伪造二维码登录或登录结果。"
      title="设置"
    />
  );
}
