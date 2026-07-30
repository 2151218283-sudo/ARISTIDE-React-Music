import { createLegacyNeteaseAdapter } from "@/lib/music/netease/index.server";

import {
  createAuthRouteHandlers,
  type AuthRouteHandlers,
} from "./authBff";
import { sessionStore } from "./sessionStore";

export const authRouteHandlers: AuthRouteHandlers = createAuthRouteHandlers({
  store: sessionStore,
  createUpstream: () => {
    const adapter = createLegacyNeteaseAdapter();
    return {
      startQrLogin: () => adapter.startQrLogin(),
      pollQrLogin: (key) => adapter.pollQrCode(key),
      getSessionUser: (upstreamCookie) => adapter.getSessionUser(upstreamCookie),
      logout: (upstreamCookie) => adapter.logout(upstreamCookie),
    };
  },
});
