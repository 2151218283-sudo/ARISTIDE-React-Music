import type { Metadata } from "next";

import { RoutePlaceholder } from "@/components/RoutePlaceholder";

export const metadata: Metadata = { title: "用户主页" };

export default function ProfilePage() {
  return (
    <RoutePlaceholder
      description="呈现个人头像、听歌品味、收藏与创建的歌单。"
      eyebrow="ECHOFORM / PROFILE"
      statusDescription="用户主页只建立本地路由，真实账号资料将在二维码登录与会话任务之后接入。"
      title="用户主页"
    />
  );
}
