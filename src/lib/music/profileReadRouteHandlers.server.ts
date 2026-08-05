import { createLegacyNeteaseAdapter } from "./netease/index.server";
import {
  createProfileReadRouteHandlers,
  type ProfileReadContext,
} from "./profileBff";
import {
  readSessionIdFromRequest,
  sessionStore,
} from "../session/sessionStore";

function resolveContext(request: Request): ProfileReadContext {
  const sessionId = readSessionIdFromRequest(request);
  if (!sessionId) {
    return { currentUser: null };
  }

  return {
    currentUser: sessionStore.getPublicState(sessionId)?.user ?? null,
    upstreamCookie: sessionStore.getUpstreamCookie(sessionId) ?? undefined,
  };
}

export const profileReadRouteHandlers = createProfileReadRouteHandlers({
  createProvider: createLegacyNeteaseAdapter,
  resolveContext,
});
