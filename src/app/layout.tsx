import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/AppShell";
import { PlayerProvider } from "@/features/player/PlayerProvider";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ECHOFORM | 声形",
    template: "%s | ECHOFORM",
  },
  description: "ECHOFORM 声形，以每日推荐为入口的沉浸式在线音乐播放器。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0C0D0D",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="zh-CN">
      <body>
        <PlayerProvider>
          <AppShell>{children}</AppShell>
        </PlayerProvider>
      </body>
    </html>
  );
}
