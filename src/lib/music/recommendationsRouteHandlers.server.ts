import { DemoMusicProvider } from "@/lib/music/demo";
import { createLegacyNeteaseAdapter } from "@/lib/music/netease/index.server";
import { createDailyRecommendationRouteHandlers } from "@/lib/music/recommendationsBff";
import { sessionStore } from "@/lib/session/sessionStore";

export const dailyRecommendationRouteHandlers = createDailyRecommendationRouteHandlers({
  store: sessionStore,
  createRealProvider: createLegacyNeteaseAdapter,
  createDemoProvider: () => new DemoMusicProvider(),
});
