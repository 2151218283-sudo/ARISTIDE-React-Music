import { createLegacyNeteaseAdapter } from "./netease/index.server";
import { createRuleRecommendationRouteHandlers } from "./ruleRecommendationBff";
import { sessionStore } from "../session/sessionStore";

export const ruleRecommendationRouteHandlers = createRuleRecommendationRouteHandlers({
  createProvider: createLegacyNeteaseAdapter,
  store: sessionStore,
});
