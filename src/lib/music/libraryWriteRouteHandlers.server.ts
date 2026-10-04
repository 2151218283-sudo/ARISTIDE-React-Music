import { DemoMusicProvider } from "./demo";
import { createLegacyNeteaseAdapter } from "./netease/index.server";
import {
  createLibraryWriteRouteHandlers,
  type LibraryWriteRouteHandlers,
} from "./libraryWriteBff";
import { sessionStore } from "../session/sessionStore";

export const libraryWriteRouteHandlers: LibraryWriteRouteHandlers = createLibraryWriteRouteHandlers({
  store: sessionStore,
  createRealProvider: createLegacyNeteaseAdapter,
  createDemoProvider: () => new DemoMusicProvider(),
});
