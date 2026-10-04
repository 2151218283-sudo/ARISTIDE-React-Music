import { DemoMusicProvider } from "./demo";
import { createLegacyNeteaseAdapter } from "./netease/index.server";
import { createPlaylistRouteHandlers } from "./playlistBff";
import { sessionStore } from "../session/sessionStore";

export const playlistRouteHandlers = createPlaylistRouteHandlers({
  store: sessionStore,
  createRealProvider: () => createLegacyNeteaseAdapter(),
  createDemoProvider: () => new DemoMusicProvider(),
});
