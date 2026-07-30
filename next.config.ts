import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
  serverExternalPackages: ["NeteaseCloudMusicApi"],
};

export default nextConfig;
