import { createCommentWriteRouteHandler } from "./commentWriteBff";
import { createLegacyNeteaseAdapter } from "./netease/index.server";
import { sessionStore } from "../session/sessionStore";

export const commentWrites = createCommentWriteRouteHandler({
  store: sessionStore,
  createProvider: createLegacyNeteaseAdapter,
});
