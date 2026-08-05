import { createPublicReadRouteHandlers } from "./bff";
import { createLegacyNeteaseAdapter } from "./netease/index.server";
import {
  readSessionIdFromRequest,
  sessionStore,
} from "../session/sessionStore";

function resolvePlaybackCredential(request: Request): string | undefined {
  const sessionId = readSessionIdFromRequest(request);
  return sessionId
    ? sessionStore.getUpstreamCookie(sessionId) ?? undefined
    : undefined;
}

export const publicReadRouteHandlers = createPublicReadRouteHandlers({
  createProvider: createLegacyNeteaseAdapter,
  resolvePlaybackCredential,
});
